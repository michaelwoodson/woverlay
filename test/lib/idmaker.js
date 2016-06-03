"use strict";

let cryptoJs = require('crypto-js');

module.exports = function(prefix) {
	let randomString = new Date().toISOString() + Math.random();
	let randomId = cryptoJs.SHA256(randomString).toString();
	return prefix + randomId.substring(prefix.length);
};
