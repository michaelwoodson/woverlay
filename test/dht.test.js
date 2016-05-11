"use strict"

let test = require('tape');
let Overlay = require('../lib/overlay').Overlay;
let LocalID = require('../lib/localid').LocalID;

let overlay = new Overlay(new LocalID(true));

test('dht with no peers', function(t) {
	overlay.put('foo', 'bar').then(() => {
		t.pass('put foo->bar into dht');
		return overlay.get('foo');
	}).then((result) => {
		t.ok('bar' == result[overlay.localid.id], 'lookup succeeded');
		t.end();
	}).catch((error) => {
		t.fail(error);
		t.end();
	});
});
