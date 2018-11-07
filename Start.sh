#!/bin/bash
cd ~/HTTP
nodemon -V --watch "server.js" ./server.js
read -n1 -r -p "Press any key to continue..." key