"use strict"

if (typeof window !== 'undefined') {
	module.exports = window.localStorage;
} else {
	let data = {};
	module.exports.getItem = function getItem(key) {
		return data[key];
	}
	module.exports.setItem = function setItem(key, value) {
		data[key] = value;
	}
}