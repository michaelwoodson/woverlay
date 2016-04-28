"use strict"

let test = require('tape');

const PORT = 5001;
process.env.PORT = PORT;
let server = require('../server.js');

let browserify = require('browserify');
let run = require('tape-run');

browserify('./browser.hammer.js').ignore('ws').ignore('wrtc').bundle().pipe(run()).on('results', (results) => {
	if (!results.ok) {
		process.exit(1);
	}
	console.log('shutting down server');
	server.shutdown();
	test('verify server', function(t) {
		t.equals(server.status.verifiedCount, 5, 'verified all overlay networks');
		t.end();
	});
}).pipe(process.stdout);

