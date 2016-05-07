"use strict"

const PORT = 5002;
process.env.PORT = PORT;
let server = require('../lib/server');
server.startup();

let browserify = require('browserify');
let run = require('tape-run');

let settings = {};
// use chrome for debugging
// let settings = {browser:'chrome'}

browserify(require.resolve('./browser.dht.js'), {debug: true}).bundle().pipe(run(settings)).on('results', (results) => {
	if (!results.ok) {
		process.exit(1);
	}
	server.shutdown();
}).pipe(process.stdout);

