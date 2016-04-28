"use strict";

module.exports = {};

if (typeof navigator === 'undefined') {
	console.log('probably running command line');
} else {
	module.exports.RTCPeerConnection = typeof RTCPeerConnection === 'undefined' ? webkitRTCPeerConnection : RTCPeerConnection;
	module.exports.RTCSessionDescription = RTCSessionDescription;
	module.exports.RTCIceCandidate = RTCIceCandidate;
	module.exports.getUserMedia = navigator.mediaDevices.getUserMedia;
	module.exports.attachMediaStream = function attachMediaStream(element, stream) {
		if (typeof element.srcObject !== 'undefined') {
			element.srcObject = stream;
		} else if (typeof element.mozSrcObject !== 'undefined') {
			element.mozSrcObject = stream;
		} else if (typeof element.src !== 'undefined') {
			element.src = URL.createObjectURL(stream);
			//element.src = stream;
		} else {
			console.log('Error attaching stream to element.');
		}
	};
	module.exports.reattachMediaStream = function reattachMediaStream(to, from) {
		to.src = from.src;
	};
}
