
var collections = ['categories', 'customers', 'northwind', 'order-details', 'orders', 'products', 'regions', 'shippers', 'suppliers', 'territories'];
var exec = require('child_process').exec;

for (var i = 0; i < collections.length; i++){
    (function(x){
        var collection = collections[x];
        exec('mongo Northwind --eval "var collection = \'' + collection + "\'\"" + ' utility/variety.js --port 27017 --quiet', function(err, stdout, stderr){
            console.log(collection);
            console.log(stdout);
        });
    })(i);
}
