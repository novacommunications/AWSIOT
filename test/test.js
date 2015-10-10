//  Automated test cases for Parse cloud and fnbserver, based on Mocha test framework.

/*jshint node: true */  //  Node.js
/*jshint smarttabs: true */  //  Allow mixed tabs and spaces.
/*global describe, before, after, it */
"use strict";

//var testDev = true; var testProd = false;  //  Test development Node server
var testProd = true; var testDev = false; //  Test fnbserver Node server

var devNodeServerURL = "http://localhost:8080/myapp/";  //  Local server
var prodNodeServerURL = "";

var assert = require("assert");
var should = require("should");
var request = require('request');
//var localNodeLambda = require('local-node-lambda');
var _ = require('underscore');

//var common = require("../app/common");

//  Source files to be checked with JSHint.
var sourceFiles = ['test/test.js',
//    'app/common.js',
];

var testInstallationId = 'testInstallationId';

//client.on("error", function (err) {
//    console.log("Error " + err);
//});

//  We are interested in this thing shadow.
var thingShadowName = "g0_temperature_sensor";

//  This is the current device state that we want to update the thing shadow.
var thingShadowState = {
    state: {
        reported: {
            temperature: 34
        },
        /*
        desired: {
            temperature: 33
        },
        */
    }
};

var awsIot = require('aws-iot-device-sdk');
var device = null;
var thingShadows = null;

// Client token value returned from thingShadows.update() operation
var clientTokenUpdate;

describe('Test', function(){

    before(function(done){
        //  Called before running any test.
        this.timeout(5000);
        done();
    });

    after(function(done){
        //  Called after running all tests.
        this.timeout(11000);

        //  Wait a while.
        setTimeout(function(){
            //  Call JSHint to check the source files.
            checkFiles(sourceFiles, 0, function(err, errorCount) {
                assert.equal(err, null);
                assert.equal(errorCount, 0);
                done();
            });
        },
        10000);
    });

    describe('Test', function(){

        it('should connect to device', function(done){
            this.timeout(5000);  //  Should be completed by this milliseconds.

            device = awsIot.device({
               keyPath: '5c46ea701f-private.pem.key',
              certPath: '5c46ea701f-certificate.pem.crt',
                caPath: 'aws-iot-rootCA.crt',
              clientId: 'myAwsClientId',
                region: 'us-west-2'
            });

            device.on('connect', function() {
                console.log('connect');
                device.subscribe('topic_1');
                device.publish('topic_2', JSON.stringify({ test_data: 1}));
                done();
            });

            device.on('message', function(topic, payload) {
                console.log('message', topic, payload.toString());
            });

        });

        it('should connect to thing shadow', function(done){
            this.timeout(5000);  //  Should be completed by this milliseconds.

            //  Connect to the thing shadow.
            thingShadows = awsIot.thingShadow({
               keyPath: '5c46ea701f-private.pem.key',
              certPath: '5c46ea701f-certificate.pem.crt',
                caPath: 'aws-iot-rootCA.crt',
              clientId: 'myAwsClientId',
                region: 'us-west-2'
            });

            thingShadows.on('connect', function() {

                // After connecting to the AWS IoT platform, register interest in the
                // Thing Shadow named thingShadowName.
                thingShadows.register( thingShadowName );

                // 2 seconds after registering, update the Thing Shadow named
                // thingShadowName with the latest device state and save the clientToken
                // so that we can correlate it with status or timeout events.
                //
                // Note that the delay is not required for subsequent updates; only
                // the first update after a Thing Shadow registration using default
                // parameters requires a delay.  See API documentation for the update
                // method for more details.
                setTimeout( function() {
                   clientTokenUpdate = thingShadows.update(thingShadowName, thingShadowState);
                   done();
                }, 2000);
            });

            thingShadows.on('status', function(thingName, stat, clientToken, stateObject) {
                   console.log('received '+stat+' on '+thingName+': '+JSON.stringify(stateObject));
            });

            thingShadows.on('delta', function(thingName, stateObject) {
                   console.log('received delta '+' on '+thingName+': '+JSON.stringify(stateObject));
            });

            thingShadows.on('timeout', function(thingName, clientToken) {
                   console.log('received timeout '+' on '+thingName+': '+clientToken);
            });
        });

    });

});

/*  Output:


  Test
    Test
opts`= { keyPath: '5c46ea701f-private.pem.key',
  certPath: '5c46ea701f-certificate.pem.crt',
  caPath: 'aws-iot-rootCA.crt',
  clientId: 'myAwsClientId',
  region: 'us-west-2',
  reconnectPeriod: 3000,
  port: 8883,
  protocol: 'mqtts',
  host: 'data.iot.us-west-2.amazonaws.com',
  key: <Buffer 2d 2d 2d 2d 2d 42 45 47 49 4e 20 52 53 41 20 50 52 49 56 41 54 45 20 4b 45 59 2d 2d 2d 2d 2d 0a 4d 49 49 45 70 67 49 42 41 41 4b 43 41 51 45 41 77 78 79 ...>,
  cert: <Buffer 2d 2d 2d 2d 2d 42 45 47 49 4e 20 43 45 52 54 49 46 49 43 41 54 45 2d 2d 2d 2d 2d 0a 4d 49 49 44 57 54 43 43 41 6b 47 67 41 77 49 42 41 67 49 55 4d 74 55 ...>,
  ca: <Buffer 2d 2d 2d 2d 2d 42 45 47 49 4e 20 43 45 52 54 49 46 49 43 41 54 45 2d 2d 2d 2d 2d 0d 0a 4d 49 49 45 30 7a 43 43 41 37 75 67 41 77 49 42 41 67 49 51 47 4e ...>,
  requestCert: true,
  rejectUnauthorized: true,
  keepalive: 10,
  protocolId: 'MQTT',
  protocolVersion: 4,
  connectTimeout: 30000,
  clean: true }
connect

      ✓ should connect to device (1511ms)
opts`= { keyPath: '5c46ea701f-private.pem.key',
  certPath: '5c46ea701f-certificate.pem.crt',
  caPath: 'aws-iot-rootCA.crt',
  clientId: 'myAwsClientId',
  region: 'us-west-2',
  reconnectPeriod: 3000,
  port: 8883,
  protocol: 'mqtts',
  host: 'data.iot.us-west-2.amazonaws.com',
  key: <Buffer 2d 2d 2d 2d 2d 42 45 47 49 4e 20 52 53 41 20 50 52 49 56 41 54 45 20 4b 45 59 2d 2d 2d 2d 2d 0a 4d 49 49 45 70 67 49 42 41 41 4b 43 41 51 45 41 77 78 79 ...>,
  cert: <Buffer 2d 2d 2d 2d 2d 42 45 47 49 4e 20 43 45 52 54 49 46 49 43 41 54 45 2d 2d 2d 2d 2d 0a 4d 49 49 44 57 54 43 43 41 6b 47 67 41 77 49 42 41 67 49 55 4d 74 55 ...>,
  ca: <Buffer 2d 2d 2d 2d 2d 42 45 47 49 4e 20 43 45 52 54 49 46 49 43 41 54 45 2d 2d 2d 2d 2d 0d 0a 4d 49 49 45 30 7a 43 43 41 37 75 67 41 77 49 42 41 67 49 51 47 4e ...>,
  requestCert: true,
  rejectUnauthorized: true,
  keepalive: 10,
  protocolId: 'MQTT',
  protocolVersion: 4,
  connectTimeout: 30000,
  clean: true }

      ✓ should connect to thing shadow (3480ms)
received accepted on g0_temperature_sensor: {"state":{"reported":{"temperature":33}},"metadata":{"reported":{"temperature":{"timestamp":1444455699}}},"timestamp":1444455699}
opts`= { keyPath: '5c46ea701f-private.pem.key',
  certPath: '5c46ea701f-certificate.pem.crt',
  caPath: 'aws-iot-rootCA.crt',
  clientId: 'myAwsClientId',
  region: 'us-west-2',
  reconnectPeriod: 3000,
  port: 8883,
  protocol: 'mqtts',
  host: 'data.iot.us-west-2.amazonaws.com',
  key: <Buffer 2d 2d 2d 2d 2d 42 45 47 49 4e 20 52 53 41 20 50 52 49 56 41 54 45 20 4b 45 59 2d 2d 2d 2d 2d 0a 4d 49 49 45 70 67 49 42 41 41 4b 43 41 51 45 41 77 78 79 ...>,
  cert: <Buffer 2d 2d 2d 2d 2d 42 45 47 49 4e 20 43 45 52 54 49 46 49 43 41 54 45 2d 2d 2d 2d 2d 0a 4d 49 49 44 57 54 43 43 41 6b 47 67 41 77 49 42 41 67 49 55 4d 74 55 ...>,
  ca: <Buffer 2d 2d 2d 2d 2d 42 45 47 49 4e 20 43 45 52 54 49 46 49 43 41 54 45 2d 2d 2d 2d 2d 0d 0a 4d 49 49 45 30 7a 43 43 41 37 75 67 41 77 49 42 41 67 49 51 47 4e ...>,
  requestCert: true,
  rejectUnauthorized: true,
  keepalive: 10,
  protocolId: 'MQTT',
  protocolVersion: 4,
  connectTimeout: 30000,
  clean: true }
connect

    1) should connect to device
opts`= { keyPath: '5c46ea701f-private.pem.key',
  certPath: '5c46ea701f-certificate.pem.crt',
  caPath: 'aws-iot-rootCA.crt',
  clientId: 'myAwsClientId',
  region: 'us-west-2',
  reconnectPeriod: 3000,
  port: 8883,
  protocol: 'mqtts',
  host: 'data.iot.us-west-2.amazonaws.com',
  key: <Buffer 2d 2d 2d 2d 2d 42 45 47 49 4e 20 52 53 41 20 50 52 49 56 41 54 45 20 4b 45 59 2d 2d 2d 2d 2d 0a 4d 49 49 45 70 67 49 42 41 41 4b 43 41 51 45 41 77 78 79 ...>,
  cert: <Buffer 2d 2d 2d 2d 2d 42 45 47 49 4e 20 43 45 52 54 49 46 49 43 41 54 45 2d 2d 2d 2d 2d 0a 4d 49 49 44 57 54 43 43 41 6b 47 67 41 77 49 42 41 67 49 55 4d 74 55 ...>,
  ca: <Buffer 2d 2d 2d 2d 2d 42 45 47 49 4e 20 43 45 52 54 49 46 49 43 41 54 45 2d 2d 2d 2d 2d 0d 0a 4d 49 49 45 30 7a 43 43 41 37 75 67 41 77 49 42 41 67 49 51 47 4e ...>,
  requestCert: true,
  rejectUnauthorized: true,
  keepalive: 10,
  protocolId: 'MQTT',
  protocolVersion: 4,
  connectTimeout: 30000,
  clean: true }

    2) should connect to thing shadow
File test/test.js has no errors. Globals: testProd, testDev, devNodeServerURL, prodNodeServerURL, assert, require, should, request, _, sourceFiles, testInstallationId, thingShadowName, thingShadowState, awsIot, device, thingShadows, clientTokenUpdate, describe, before, after, setTimeout, it, console, JSON, checkFiles, testServer, callServer


  2 passing (15s)
  2 failing

  1) Test Test should connect to device:
     Error: done() called multiple times
      at Test.Runnable (/usr/local/lib/node_modules/mocha/lib/runnable.js:50:17)
      at new Test (/usr/local/lib/node_modules/mocha/lib/test.js:22:12)
      at context.it.context.specify (/usr/local/lib/node_modules/mocha/lib/interfaces/bdd.js:87:18)
      at Suite.<anonymous> (/Users/Luppy/Temasek Poly/IoT/AWSIOT/test/test.js:83:9)
      at context.describe.context.context (/usr/local/lib/node_modules/mocha/lib/interfaces/bdd.js:49:10)
      at Suite.<anonymous> (/Users/Luppy/Temasek Poly/IoT/AWSIOT/test/test.js:81:5)
      at context.describe.context.context (/usr/local/lib/node_modules/mocha/lib/interfaces/bdd.js:49:10)
      at Object.<anonymous> (/Users/Luppy/Temasek Poly/IoT/AWSIOT/test/test.js:57:1)
      at Module._compile (module.js:456:26)
      at Object.Module._extensions..js (module.js:474:10)
      at Module.load (module.js:356:32)
      at Function.Module._load (module.js:312:12)
      at Module.require (module.js:364:17)
      at require (module.js:380:17)
      at /usr/local/lib/node_modules/mocha/lib/mocha.js:187:27
      at Array.forEach (native)
      at Mocha.loadFiles (/usr/local/lib/node_modules/mocha/lib/mocha.js:184:14)
      at Mocha.run (/usr/local/lib/node_modules/mocha/lib/mocha.js:405:31)
      at Object.<anonymous> (/usr/local/lib/node_modules/mocha/bin/_mocha:405:16)
      at Module._compile (module.js:456:26)
      at Object.Module._extensions..js (module.js:474:10)
      at Module.load (module.js:356:32)
      at Function.Module._load (module.js:312:12)
      at Function.Module.runMain (module.js:497:10)
      at startup (node.js:119:16)
      at node.js:906:3

  2) Test Test should connect to thing shadow:
     Error: done() called multiple times
      at Test.Runnable (/usr/local/lib/node_modules/mocha/lib/runnable.js:50:17)
      at new Test (/usr/local/lib/node_modules/mocha/lib/test.js:22:12)
      at context.it.context.specify (/usr/local/lib/node_modules/mocha/lib/interfaces/bdd.js:87:18)
      at Suite.<anonymous> (/Users/Luppy/Temasek Poly/IoT/AWSIOT/test/test.js:107:9)
      at context.describe.context.context (/usr/local/lib/node_modules/mocha/lib/interfaces/bdd.js:49:10)
      at Suite.<anonymous> (/Users/Luppy/Temasek Poly/IoT/AWSIOT/test/test.js:81:5)
      at context.describe.context.context (/usr/local/lib/node_modules/mocha/lib/interfaces/bdd.js:49:10)
      at Object.<anonymous> (/Users/Luppy/Temasek Poly/IoT/AWSIOT/test/test.js:57:1)
      at Module._compile (module.js:456:26)
      at Object.Module._extensions..js (module.js:474:10)
      at Module.load (module.js:356:32)
      at Function.Module._load (module.js:312:12)
      at Module.require (module.js:364:17)
      at require (module.js:380:17)
      at /usr/local/lib/node_modules/mocha/lib/mocha.js:187:27
      at Array.forEach (native)
      at Mocha.loadFiles (/usr/local/lib/node_modules/mocha/lib/mocha.js:184:14)
      at Mocha.run (/usr/local/lib/node_modules/mocha/lib/mocha.js:405:31)
      at Object.<anonymous> (/usr/local/lib/node_modules/mocha/bin/_mocha:405:16)
      at Module._compile (module.js:456:26)
      at Object.Module._extensions..js (module.js:474:10)
      at Module.load (module.js:356:32)
      at Function.Module._load (module.js:312:12)
      at Function.Module.runMain (module.js:497:10)
      at startup (node.js:119:16)
      at node.js:906:3

[Finished in 15.5s with exit code 2]
*/

function checkFiles(files, errorCount, callback)
{
    //  Run JSHint on the list of files recursively.  Call the callback when completed.
    if (files.length === 0) {
        return callback(null, errorCount);
    }
    var fs = require('fs'),
        filename = files[0];
    files.shift();
    fs.readFile(filename, function(err, data) {
        if (err) {
            console.log('Error: ' + err);
            return callback("Missing file " + filename);
        }
        var jshint = require('jshint').JSHINT;
        if(jshint(data.toString())) {
            // List globals
            var out2 = jshint.data();
            var globals2 = "";
            if (out2.globals) {
                for (var k = 0; k < out2.globals.length; k++) {
                    if (globals2.length > 0) globals2 = globals2 + ", ";
                    globals2 = globals2 + out2.globals[k];
                }
            }
            console.log('File ' + filename + ' has no errors. Globals: ' + globals2);
            return checkFiles(files, errorCount, callback);
        }
        var out = jshint.data(),
            errors = out.errors;
        errorCount = errorCount + errors.length;
        var filename2 = filename;
        var pos = filename.lastIndexOf("/");
        if (pos >= 0) filename2 = filename.substr(pos + 1);
        console.log('File ' + filename + ' has ' + errors.length + ' errors:');
        for (var j = 0; j < errors.length; j++) {
            //  at /Users/Luppy/test/test.js:1299:20
            console.log('  at ' + filename2 + ':' + (errors[j] ? errors[j].line : "?") + ':' + errors[j].character + ' -> ' + errors[j].reason + ' -> ' + errors[j].evidence);
        }
        // List globals
        var globals = "";
        for(j = 0; j < out.globals.length; j++) {
            if (globals.length > 0) globals = globals + ", ";
            globals = globals + out.globals[j];
        }
        console.log('Globals: ' + globals);
        return checkFiles(files, errorCount, callback);
    });
}

function testServer(nodeServerSubURL, method, body, callback)
{
    //  Call dev/prod server, depending on flags.
    //  Method=GET or POST (default)
    if (testDev)
        callServer(devNodeServerURL + nodeServerSubURL, method, body, callback);
    if (testProd)
        callServer(prodNodeServerURL + nodeServerSubURL, method, body, callback);
}

function callServer(url, method, body, callback)
{
    //  Call the REST server.
    if (body) body.deviceinstallationid = testInstallationId;
    var options = {
        method: method === 'GET' ? method : 'POST',
        url: url,
        headers: {
            'Content-Type': 'application/json;charset=utf-8'
        },
        form: body
    };
    request(options,
        function (error, response, responseBody) {
            if (!error && response.statusCode == 200) {
                callback.success(responseBody);
            }
            else {
                callback.error(error);
            }
        }
    );
}

