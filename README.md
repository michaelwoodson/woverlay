# woverlay

## Status

This module is a work in progress as the version number indicates.
I'm currently using it as the basis for a couple projects, but as of 0.0.x haven't even tested beyond a local network.
Once the module is stabilized I'll document the api.

## What is it?

The w in "woverlay" is for WebRTC; woverlay is a peer 2 peer overlay network built on WebRTC.
Depending on your disposition you can read it as a Keanu Reeves "woah" or a more shakespearean "woe".
The network is similar to a Chord network, substitute "vertical" for "finger".

The architecture uses a central websocket server for bootstrapping into the network.
Once a peer is bootstrapped it uses WebRTC for building the rest of the network and signaling, so the load on the server should be minimal.

* No effort to support browsers that don't have WebRTC, so most ES6 features can be used without transpiling (browserify, but no need to babelify).
* Requires bootstrapping peers to connect in both directions with only STUN servers, asymmetric NATs and tight firewalls won't be able to join the network.
