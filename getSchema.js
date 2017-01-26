var _ = require('underscore');
var jsonfile = require('jsonfile');
var exec = require('child_process').exec;
var mongodb = require('mongodb');
var MongoClient = mongodb.MongoClient;

if (process.argv.length < 5) {
    console.log('Error: One of the following was not provided: hostname, port, or database name.');
    return false;
}

var hostname = process.argv[2];
var port = process.argv[3];
var databaseName = process.argv[4];
var url = 'mongodb://' + hostname + ':' + port + '/' + databaseName;

// Use connect method to connect to the Server
MongoClient.connect(url, function (err, db) {
    var dbInfo = {};
    if (err) {
        console.log('Unable to connect to the mongoDB server. Error:', err);
    } else {
        console.log('Connection established to', url);

        db.listCollections().toArray(function (err, collections) {
            var collectionNames = collections.map(function (c) {
                return c.name
            });

            var lastCollectionName = _.last(collectionNames);
            collectionNames.forEach(function (name) {
                console.log('running collection: ' + name.toUpperCase());
                exec('mongo ' + databaseName + ' --eval "var collection = \'' + name + "\', outputFormat=\'json\'\"" + ' variety.js --port ' + port + ' --quiet', function (err, stdout, stderr) {
                    var json = [];
                    if (stdout) {

                        try {
                            json = JSON.parse(stdout);
                        } catch (e) {
                            console.log('PROBLEM WITH STDOUT', stdout);
                        }

                        var collectionInfo = _.map(json, function (j) {
                            var types = _.map(j.value.types, function (t, tk) {
                                return tk + '(' + t + ')';
                            }).join(', ');
                            return {field: j._id.key, types: types};
                        });
                        dbInfo[name] = collectionInfo;
                        if (name === lastCollectionName) {
                            var file = '/usr/local/scripts/dbInfo.js';

                            // clear file
                            exec('> ' + file, function () {
                                console.log('clear finished');
                                jsonfile.writeFile(file, dbInfo, {spaces: 2}, function (err) {
                                    console.log('write json finished');
                                    if (err) {
                                        console.error(err)
                                    } else {
                                        exec('echo "var collectionFields = " | cat - ' + file + ' > temp && mv temp ' + file);
                                    }
                                });
                            });
                        }
                    }
                });
            });
            db.close();
        });
    }
});
