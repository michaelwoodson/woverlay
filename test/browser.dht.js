"use strict"

let test = require('tape');

let idJsonArray = require('./lib/test.localids.25')
let LocalID = require('../lib/localid').LocalID;
let Overlay = require('../lib/overlay').Overlay;
let idhelper = require('../lib/idhelper');

const DEFAULT_SECONDS_TO_WAIT = 10;
const PORT = 5002;

let overlays = [];
let overlayMap = new Map();
idJsonArray.forEach((idJson, index) => {
	let localid = new LocalID(false, null, idJson);
	let overlay = makeOverlay(localid);
	overlays.push(overlay);
	overlayMap.set(localid.id.substring(0, 5), overlay);
});

test('dht', function(t) {
	const WAIT_TIME = 240000;
	let o60e53 = overlayMap.get('60e53');
	waitFor(()=>{
		let pendingCount = overlays.map(o => o.pendingEnvelopes.length).reduce((a,b) => a+b);
		let floodCount = overlays.map(o => o.flood.length).reduce((a,b) => a+b);
		//console.log(`pendingCount: ${pendingCount}, averageFlood: ${floodCount/overlays.length}, overlay: ${idhelper.shortArray(o60e53.flood)} target: ${idhelper.shortArray(o60e53.targetFlood())}`);
		return o60e53.flood.length == 5;
		}, WAIT_TIME)
	.then(() => {
		t.pass('full flood');
		return waitFor(() => o60e53.flood[0].indexOf('5c987') == 0, WAIT_TIME);
	}).then(() => {
		t.pass('got peer on left');
		return waitFor(() => o60e53.flood[4].indexOf('7268d') == 0, WAIT_TIME);
	}).then(() => { 
		t.pass('got peer on right');
		t.end();
	}).catch(() => {
		t.fail('failed waiting for dht');
		t.end()
	});
});

function waitFor(assertion, secondsToWait = DEFAULT_SECONDS_TO_WAIT) {
	return new Promise((resolve, reject) => {
		let counter = 0;
		setInterval(() => {
			if (assertion()) {
				resolve();
			} else if (counter++ >= secondsToWait) {
				reject();
			}
		}, 1000);
	});
}

function makeOverlay(localid) {
	let overlay = new Overlay(localid, 'ws://localhost:' + PORT + '/');
	overlay.connect();
	return overlay;
}
