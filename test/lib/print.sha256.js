"use strict"

let cryptoJs = require('crypto-js');

if (process.argv.length == 3) {
	console.log('hash: ' + cryptoJs.SHA256(process.argv[2]).toString());
} else {
	console.log('pass exactly one argument to hash');
}
