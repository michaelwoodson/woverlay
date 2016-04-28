"use strict";

let cryptoJs = require('crypto-js');
let NodeRSA = require('node-rsa');

module.exports.pack = pack;
module.exports.unpack = unpack;

function pack(data, key) {
	data.publicKey = key.exportKey('pkcs8-public-pem');
	let signed = JSON.stringify(data); 
	return {
		signed: signed,
		signature: key.sign(signed, 'base64', 'utf8')
	}
}

function unpack(id, data) {
	try {
		let signed = JSON.parse(data.signed);
		let publicKey = new NodeRSA();
		publicKey.importKey(signed.publicKey, 'pkcs8-public-pem');
		let expectedId = cryptoJs.SHA256(signed.publicKey).toString();
		if (expectedId == id && publicKey.verify(data.signed, data.signature, 'utf8', 'base64')) {
			return signed;
		} else {
			return null;
		}
	} catch (error) {
		return null;
	}
}
