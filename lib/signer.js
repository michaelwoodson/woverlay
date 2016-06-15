'use strict';

let cryptoJs = require('crypto-js');
let NodeRSA = require('node-rsa');

module.exports.pack = pack;
module.exports.unpack = unpack;

function pack(data, key) {
	data.publicKey = key.exportKey('pkcs8-public-pem');
	let signed = JSON.stringify(data);
	let hashed = cryptoJs.SHA256(signed).toString();
	let signature = key.sign(hashed, 'base64', 'utf8');
	return {
		signed: signed,
		signature: signature
	};
}

function unpack(id, data) {
	try {
		let hashed = cryptoJs.SHA256(data.signed).toString();
		let signed = JSON.parse(data.signed);
		let publicKey = new NodeRSA();
		publicKey.importKey(signed.publicKey, 'pkcs8-public-pem');
		let expectedId = cryptoJs.SHA256(signed.publicKey).toString();
		if (expectedId == id && publicKey.verify(hashed, data.signature, 'utf8', 'base64')) {
			return signed;
		} else {
			return null;
		}
	} catch (error) {
		return null;
	}
}
