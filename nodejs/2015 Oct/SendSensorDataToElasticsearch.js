//  This AWS Lambda function accepts a JSON input of sensor values and sends them to AWS Elasticache
//  search engine for indexing.  It also sends to AWS CloudWatch and posts a message to Slack.  The input looks like:
//  {"temperature":84,"timestampText":"2015-10-11T09:18:51.604Z","version":139,
//  "xTopic":"$aws/things/g0_temperature_sensor/shadow/update/accepted","xClientToken":"myAwsClientId-0"}
//  Make sure the role executing this Lambda function has CloudWatch PutMetricData and PutMetricAlarm permissions.

//  List of device names and the replacement Slack channels for the device.
//  Used if the channel name is already taken up.  Sync this with ActuateDeviceFromSlack and SetDesiredState.
replaceSlackChannels = {
    "g16-pi": "g16",
    "g16b-pi": "g16",
    "g29": "g29a",
    "g88": "g88a",
    "g28_pi":"g28",
    "g28-pi":"g28"
}

var https = require('https');
var zlib = require('zlib');
var crypto = require('crypto');

//  Init the AWS connection.
var AWS = require('aws-sdk');
AWS.config.region = 'us-west-2';
//AWS.config.logger = process.stdout;  //  Debug
var cloudwatch = new AWS.CloudWatch();

var endpoint = 'search-iot-74g6su3n4aupthnnhffmvewv2a.us-west-2.es.amazonaws.com';

exports.handler = function(input, context) {
    console.log("SendSensorData Input:", JSON.stringify(input));
    console.log("SendSensorData Context:", JSON.stringify(context));
    //  Format the sensor data into an Elasticache update request.
    var extractedFields = {};
    var action = "";
    var device = "Unknown";
    //  Get the device name.
    if (input.device) {
        device = input.device
    }
    else {
        if (input.xTopic) {
            //  We split the topic to get the device name.  The topic looks like "$aws/things/g0_temperature_sensor/shadow/update/accepted"
            var topicArray = input.xTopic.split("/");
            if (topicArray.length >= 3)
                device = topicArray[2];
        }
        extractedFields.device = device;
    }
    //  Copy the keys and values and send to CloudWatch.
    var actionCount = 0;
    var sensorData = {};
    for (var key in input) {
        var value = input[key];
        extractedFields[key] = value;
        if (action.length > 0)
            action = action + ", ";
        action = action + key + ": " + value;
        actionCount++;
        sensorData[key] = value;
        //  If the value is numeric, send the metric to CloudWatch.
        if (key != "version" && !isNaN(value)) {
            writeMetricToCloudWatch(device, key, value);
        }
    }
    //  Don't index response to set desired state.
    if (actionCount == 2)
        return context.succeed('Ignoring response to set desired state');

    if (!extractedFields.action)
        extractedFields.action = action;
    if (!extractedFields.event)
        extractedFields.event = "RecordSensorData";
    if (!extractedFields.topicname && extractedFields.xTopic)
        extractedFields.topicname = extractedFields.xTopic;

    var awslogsData = {
        "messageType": "DATA_MESSAGE",
        "owner": "595779189490",
        "logGroup": "AWSIotLogs",
        "logStream": "g0_temperature_sensor",
        "subscriptionFilters": [
            "ElasticsearchStream_iot"
        ],
        "logEvents": [
            {
                "id": context.awsRequestId,
                "timestamp": 1 * (new Date()),
                "message": JSON.stringify(input),
                "extractedFields": extractedFields
            }
        ]
    };
    console.log("SendSensorData awslogsData:", JSON.stringify(awslogsData));

    // transform the input to Elasticsearch documents
    var elasticsearchBulkData = transform(awslogsData);

    // skip control messages
    if (!elasticsearchBulkData) {
        console.log('Received a control message');
        context.succeed('Success');
    }

    // post documents to Amazon Elasticsearch
    post(elasticsearchBulkData, function(error, success, statusCode, failedItems) {
        console.log('SendSensorData Response: ' + JSON.stringify({
                "statusCode": statusCode
            }));

        if (error) {
            console.log('SendSensorData Error: ' + JSON.stringify(success, null, 2));

            if (failedItems && failedItems.length > 0) {
                console.log("Failed Items: " +
                    JSON.stringify(failedItems, null, 2));
            }

            context.fail(e);
        }

        console.log('SendSensorData Success: ' + JSON.stringify(success));
        //  Post a Slack message to the private group of the same name e.g. g88.
        return postSensorDataToSlack(device, sensorData, function(err, result) {
            context.succeed('Success');
        });
    });
};

function writeMetricToCloudWatch(device, metric, value) {
    //  Write the sensor data as a metric to CloudWatch.
    console.log("writeMetricToCloudWatch:", device, metric, value);
    try {
        var params = {
            MetricData: [{
                MetricName: metric,
                Timestamp: new Date(),
                Unit: 'None',
                Value: value
            }],
            Namespace: device
        };
        cloudwatch.putMetricData(params, function(err, data) {
            if (err) return console.log("putMetricData error:", err, err.stack); // an error occurred
            console.log("putMetricData: ", data);  // successful response
        });
    }
    catch(err) {
        console.log("Unable to log to CloudWatch", err);
    }
}

function transform(payload) {
    if (payload.messageType === 'CONTROL_MESSAGE') {
        return null;
    }

    var bulkRequestBody = '';

    payload.logEvents.forEach(function(logEvent) {
        // logevent.extractedFields.data contains "EVENT:UpdateThingShadow TOPICNAME:$aws/things/g0_temperature_sensor/shadow/update THINGNAME:g0_temperature_sensor"
        // We extract the fields.
        parseIoTFields(logEvent);

        var timestamp = new Date(1 * logEvent.timestamp);

        // index name format: cwl-YYYY.MM.DD
        var indexName = [
            'cwl-' + timestamp.getUTCFullYear(),              // year
            ('0' + (timestamp.getUTCMonth() + 1)).slice(-2),  // month
            ('0' + timestamp.getUTCDate()).slice(-2)          // day
        ].join('.');

        var source = buildSource(logEvent.message, logEvent.extractedFields);
        source['@id'] = logEvent.id;
        source['@timestamp'] = new Date(1 * logEvent.timestamp).toISOString();
        source['@message'] = logEvent.message;
        source['@owner'] = payload.owner;
        source['@log_group'] = payload.logGroup;
        source['@log_stream'] = payload.logStream;

        var action = { "index": {} };
        action.index._index = indexName;
        action.index._type = payload.logGroup;
        action.index._id = logEvent.id;

        bulkRequestBody += [
                JSON.stringify(action),
                JSON.stringify(source),
            ].join('\n') + '\n';
    });
    return bulkRequestBody;
}

function buildSource(message, extractedFields) {
    if (extractedFields) {
        var source = {};

        for (var key in extractedFields) {
            if (extractedFields.hasOwnProperty(key) && extractedFields[key]) {
                var value = extractedFields[key];

                if (isNumeric(value)) {
                    source[key] = 1 * value;
                    continue;
                }

                jsonSubString = extractJson(value);
                if (jsonSubString !== null) {
                    source['$' + key] = JSON.parse(jsonSubString);
                }

                source[key] = value;
            }
        }
        return source;
    }

    jsonSubString = extractJson(message);
    if (jsonSubString !== null) {
        return JSON.parse(jsonSubString);
    }

    return {};
}

function extractJson(message) {
    var jsonStart = message.indexOf('{');
    if (jsonStart < 0) return null;
    var jsonSubString = message.substring(jsonStart);
    return isValidJson(jsonSubString) ? jsonSubString : null;
}

function isValidJson(message) {
    try {
        JSON.parse(message);
    } catch (e) { return false; }
    return true;
}

function isNumeric(n) {
    return !isNaN(parseFloat(n)) && isFinite(n);
}

function post(body, callback) {
    var requestParams = buildRequest(endpoint, body);

    var request = https.request(requestParams, function(response) {
        var responseBody = '';
        response.on('data', function(chunk) {
            responseBody += chunk;
        });
        response.on('end', function() {
            var info = JSON.parse(responseBody);
            var failedItems;
            var success;

            if (response.statusCode >= 200 && response.statusCode < 299) {
                failedItems = info.items.filter(function(x) {
                    return x.index.status >= 300;
                });

                success = {
                    "attemptedItems": info.items.length,
                    "successfulItems": info.items.length - failedItems.length,
                    "failedItems": failedItems.length
                };
            }

            var error = response.statusCode !== 200 || info.errors === true ? {
                "statusCode": response.statusCode,
                "responseBody": responseBody
            } : null;

            callback(error, success, response.statusCode, failedItems);
        });
    }).on('error', function(e) {
        callback(e);
    });
    request.end(requestParams.body);
}

function buildRequest(endpoint, body) {
    var endpointParts = endpoint.match(/^([^\.]+)\.?([^\.]*)\.?([^\.]*)\.amazonaws\.com$/);
    var region = endpointParts[2];
    var service = endpointParts[3];
    var datetime = (new Date()).toISOString().replace(/[:\-]|\.\d{3}/g, '');
    var date = datetime.substr(0, 8);
    var kDate = hmac('AWS4' + process.env.AWS_SECRET_ACCESS_KEY, date);
    var kRegion = hmac(kDate, region);
    var kService = hmac(kRegion, service);
    var kSigning = hmac(kService, 'aws4_request');

    var request = {
        host: endpoint,
        method: 'POST',
        path: '/_bulk',
        body: body,
        headers: {
            'Content-Type': 'application/json',
            'Host': endpoint,
            'Content-Length': Buffer.byteLength(body),
            'X-Amz-Security-Token': process.env.AWS_SESSION_TOKEN,
            'X-Amz-Date': datetime
        }
    };

    var canonicalHeaders = Object.keys(request.headers)
        .sort(function(a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; })
        .map(function(k) { return k.toLowerCase() + ':' + request.headers[k]; })
        .join('\n');

    var signedHeaders = Object.keys(request.headers)
        .map(function(k) { return k.toLowerCase(); })
        .sort()
        .join(';');

    var canonicalString = [
        request.method,
        request.path, '',
        canonicalHeaders, '',
        signedHeaders,
        hash(request.body, 'hex'),
    ].join('\n');

    var credentialString = [ date, region, service, 'aws4_request' ].join('/');

    var stringToSign = [
        'AWS4-HMAC-SHA256',
        datetime,
        credentialString,
        hash(canonicalString, 'hex')
    ] .join('\n');

    request.headers.Authorization = [
        'AWS4-HMAC-SHA256 Credential=' + process.env.AWS_ACCESS_KEY_ID + '/' + credentialString,
        'SignedHeaders=' + signedHeaders,
        'Signature=' + hmac(kSigning, stringToSign, 'hex')
    ].join(', ');

    return request;
}

function hmac(key, str, encoding) {
    return crypto.createHmac('sha256', key).update(str, 'utf8').digest(encoding);
}

function hash(str, encoding) {
    return crypto.createHash('sha256').update(str, 'utf8').digest(encoding);
}

//  Added for TP-IOT
function parseIoTFields(logEvent) {
    // logevent.extractedFields.data contains "EVENT:UpdateThingShadow TOPICNAME:$aws/things/g0_temperature_sensor/shadow/update THINGNAME:g0_temperature_sensor"
    // We extract the fields.  Do the same for logevent.extractedFields.event.  Also we remove "TRACEID:", "PRINCIPALID:", "EVENT:" from the existing fields.
    //console.log("parseIoTFields logEvent=", JSON.stringify(logEvent, null, 2));
    var fields = logEvent.extractedFields;
    if (fields.traceid) fields.traceid = fields.traceid.replace("TRACEID:", "");
    if (fields.principalid) fields.principalid = fields.principalid.replace("PRINCIPALID:", "");
    //  Parse the data field.
    if (fields.data) {
        parseIoTData(fields, fields.data);
        delete fields.data;
    }
    //  Parse the event field.
    if (fields.event && fields.event.indexOf(":") > 0) {
        parseIoTData(fields, fields.event);
        delete fields.event;
    }
}

function parseIoTData(fields, data) {
    // data contains "EVENT:UpdateThingShadow TOPICNAME:$aws/things/g0_temperature_sensor/shadow/update THINGNAME:g0_temperature_sensor"
    // We extract the fields and populate into the "fields" collection.
    var pos = 0;
    var lastPos = -1;
    var lastFieldName = null;
    for (;;) {
        var match = matchIoTField(data, pos);
        if (match.pos < 0) break;
        if (lastPos < 0) {
            //  First iteration.
            lastPos = 0;
            pos = match.pos + 1;
            lastFieldName = match.fieldName;
        }
        else {
            //  Extract from lastPos to match.pos.
            var nameAndValue = data.substring(lastPos, match.pos);
            var value = nameAndValue.substr(lastFieldName.length + 1).trim();
            fields[normaliseFieldName(lastFieldName)] = value;
            lastPos = match.pos;
            lastFieldName = match.fieldName;
            pos = match.pos + 1;
        }
    }
    //  Extract the last field.
    if (lastPos >= 0) {
        var nameAndValue2 = data.substr(lastPos);
        var value2 = nameAndValue2.substr(lastFieldName.length + 1).trim();
        fields[normaliseFieldName(lastFieldName)] = value2;
    }
    return "";
}

function matchIoTField(data, pos) {
    //  event contains "EVENT:UpdateThingShadow TOPICNAME:$aws/things/g0_temperature_sensor/shadow/update THINGNAME:g0_temperature_sensor"
    //  We return the next position on or after pos that matches an IoT field (e.g. "EVENT:"), and return the field name.
    if (pos >= data.length) return { pos: -1, fieldName: "" };
    var fieldNames = [
        "Action",
        "CLIENTID",
        "EVENT",
        "Matching rule found",
        "MESSAGE",
        "Message arrived on",
        "Message Id",
        "SendSensorData awslogsData",
        "SendSensorData Context",
        "SendSensorData Input",
        "SendSensorData logEvent",
        "SendSensorData Response",
        "SendSensorData Success",
        "Status",
        "Target Arn",
        "THINGNAME",
        "TOPICNAME",
    ];
    var matchPos = -1;
    var matchFieldName = null;
    fieldNames.forEach(function(fieldName) {
        var fieldPos = data.toLowerCase().indexOf(fieldName.toLowerCase() + ":", pos);
        if (fieldPos < 0) return;
        if (matchPos < 0 || fieldPos < matchPos) {
            matchPos = fieldPos;
            matchFieldName = fieldName;
        }
    });
    var result = {
        pos: matchPos,
        fieldName: matchFieldName
    };
    //console.log("result=", result);
    return result;
}

function normaliseFieldName(fieldName) {
    //  If the field name contains spaces, change them to underscore. Make the field name lowercase.
    return fieldName.toLowerCase().split(" ").join("_");
}

function postSensorDataToSlack(device, sensorData, callback) {
    //  Post the sensor values to a Slack group for the device e.g. g88.
    //  device is assumed to begin with the group name. sensorData contains
    //  the sensor values.
    if (!device) return;
    var channel = "";
    var pos = device.indexOf("_");
    if (pos > 0)
        channel = device.substring(0, pos);
    var url = "http://d3gc5unrxwbvlo.cloudfront.net/_plugin/kibana/#/discover/Sensor-Data?_g=(refreshInterval:(display:'10%20seconds',section:1,value:10000),time:(from:now-1d,mode:quick,to:now))&_a=(query:(query_string:(analyze_wildcard:!t,query:'%%CHANNEL%%*')))"
    url = url.split("%%CHANNEL%%").join(channel);

    //  Clone a copy.
    var sensorData2 = JSON.parse(JSON.stringify(sensorData));

    //  Combine the less important fields.
    var otherFields = "";
    if (sensorData2.timestampText) {
        otherFields = otherFields + " - " + sensorData2.timestampText.substr(0, 19);
        delete sensorData2.timestampText;
    }
    if (sensorData2.xTopic) {
        otherFields = otherFields + " - " + sensorData2.xTopic;
        delete sensorData2.xTopic;
    }
    if (sensorData2.version) {
        otherFields = otherFields + " - " + sensorData2.version;
        delete sensorData2.version;
    }
    //  Add each field.
    var fields = [];
    for (var key in sensorData2) {
        fields.push({
            "title": key,
            "value": sensorData2[key] + "",
            "short": true
        });
    }
    if (otherFields.length > 0)
        fields.push({
            "title": "",
            "value": "_" + otherFields + "_",
            "short": false
        });
    //  Compose and send the attachment to Slack.
    var attachment = {
        "mrkdwn_in": ["fields"],
        "fallback": JSON.stringify(sensorData),
        "color": "#439FE0",
        //"pretext": "Optional text that appears above the attachment block",
        //"author_name": "Bobby Tables",
        //"author_link": "http://flickr.com/bobby/",
        //"author_icon": "http://flickr.com/icons/bobby.jpg",
        "title": "Received sensor data (Click for more...)",
        "title_link": url,
        //"text": "Optional text that appears within the attachment",
        "fields": fields,
        //"image_url": "http://my-website.com/path/to/image.jpg",
        //"thumb_url": "http://example.com/path/to/thumb.png"
    };
    postToSlack(device, [attachment], callback);
}

function postToSlack(device, textOrAttachments, callback) {
    //  Post a Slack message to the private group of the same name e.g. g88.
    //  device is assumed to begin with the group name. text is the text
    //  message, attachments is the Slack rich text format.
    if (!device) return;
    var channel = "g88";
    var pos = device.indexOf("_");
    if (pos > 0)
        channel = device.substring(0, pos);
    if (replaceSlackChannels[device])
        channel = replaceSlackChannels[device];
    else if (replaceSlackChannels[channel])
        channel = replaceSlackChannels[channel];
    var body = {
        channel: "#" + channel,
        username: device
    };
    if (textOrAttachments[0] && textOrAttachments[0].length == 1)
        body.text = textOrAttachments;
    else
        body.attachments = textOrAttachments;

    var options = {
        hostname: "hooks.slack.com",
        path: "/services/T09SXGWKG/B0EM7LDD3/o7BGhWDlrqVtnMlbdSkqisoS",
        //path: '/services/T09SXGWKG/B0CQ23S3V/yT89hje6TP6r81xX91GJOx9Y',
        method: 'POST'
    };
    console.log("Slack request =", JSON.stringify(body));
    var req = https.request(options, function(res) {
        var body = '';
        //console.log('Status:', res.statusCode);
        //console.log('Headers:', JSON.stringify(res.headers));
        res.setEncoding('utf8');
        res.on('data', function(chunk) {
            body += chunk;
            //console.log(body);
        });
        res.on('end', function() {
            //console.log('Successfully processed HTTPS response');
            // If we know it's JSON, parse it
            if (res.headers['content-type'] === 'application/json') {
                body = JSON.parse(body);
            }
            return callback(null, body);
        });
    });
    req.on('error', function() {
        return callback("error");
    });
    req.write(JSON.stringify(body));
    req.end();
}