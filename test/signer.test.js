'use strict';

let test = require('tape');
let signer = require('../lib/signer');
let cryptoJs = require('crypto-js');
let NodeRSA = require('node-rsa');

test('unpack', function(t) {
	let key = new NodeRSA({b: 512});
	let id = cryptoJs.SHA256(key.exportKey('pkcs8-public-pem')).toString();
	let message = {test: 'message'};
	let data = signer.pack(message, key);
	let signed = signer.unpack(id, data);
	t.equals(signed.test, 'message');
	t.end();
});

test('tampered no key unpack', function(t) {
	let key = new NodeRSA({b: 512});
	let id = cryptoJs.SHA256(key.exportKey('pkcs8-public-pem')).toString();
	let message = {test: 'message'};
	let data = signer.pack(message, key);
	data.signed = JSON.stringify({test: 'message'});
	let signed = signer.unpack(id, data);
	t.notOk(signed);
	t.end();
});

test('altered unpack', function(t) {
	let key = new NodeRSA({b: 512});
	let id = cryptoJs.SHA256(key.exportKey('pkcs8-public-pem')).toString();
	let message = {test: 'message'};
	let data = signer.pack(message, key);
	key = new NodeRSA({b: 512});
	data.signed = JSON.stringify({test: 'altered', publicKey: key.exportKey('pkcs8-public-pem')});
	let signed = signer.unpack(id, data);
	t.notOk(signed);
	t.end();
});

test('bogus id unpack', function(t) {
	let key = new NodeRSA({b: 512});
	let message = {test: 'message'};
	let data = signer.pack(message, key);
	let signed = signer.unpack('fakeid', data);
	t.notOk(signed);
	t.end();
});
