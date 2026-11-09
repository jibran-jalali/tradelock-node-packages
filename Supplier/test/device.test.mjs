import test from 'node:test';import assert from 'node:assert/strict';
import {parseTailscaleStatus,tailscaleAddress,pairedAnnouncement} from '../node/src/tailscale.mjs';
import {renderConsole} from '../scripts/device-console.mjs';
test('Tailscale requires Running, an own VPN address and an online device',()=>{
 assert.equal(parseTailscaleStatus({BackendState:'NeedsLogin',Self:{TailscaleIPs:['100.64.1.1']}}).connected,false);
 assert.equal(parseTailscaleStatus({BackendState:'Running',Self:{Online:false,TailscaleIPs:['100.64.1.1']}}).connected,false);
 assert.equal(parseTailscaleStatus({BackendState:'Running',Self:{Online:true,TailscaleIPs:['100.64.1.1']}}).connected,true);
});
test('VPN discovery filters offline, public and own addresses',()=>{
 const state=parseTailscaleStatus({BackendState:'Running',Self:{Online:true,TailscaleIPs:['100.64.1.1']},Peer:{a:{Online:true,TailscaleIPs:['100.64.1.2','8.8.8.8','::1']},b:{Online:false,TailscaleIPs:['100.64.1.3']},c:{Online:true,TailscaleIPs:['100.64.1.1']}}});assert.deepEqual(state.peers,['100.64.1.2']);
});
test('Tailscale addresses exclude LAN, public and malformed IPv4 values',()=>{
 for(const ip of ['100.64.0.1','100.127.255.254'])assert.ok(tailscaleAddress(ip));
 for(const ip of ['192.168.1.2','100.63.1.2','100.128.1.2','100.64.999.1','100.64.1.2/path'])assert.equal(tailscaleAddress(ip),false);
});
test('only the pinned counterpart on the pinned genesis is paired',()=>{
 const cfg={role:'host',networkId:'n',friendPublicKey:'friend'},descriptor={genesisHash:'g'};
 const good={protocolVersion:2,networkId:'n',publicKey:'friend',genesisHash:'g',p2pPort:30314};assert.ok(pairedAnnouncement(good,cfg,descriptor));
 for(const change of [{publicKey:'other'},{networkId:'different'},{genesisHash:'fork'},{p2pPort:0},{p2pPort:65536}])assert.equal(pairedAnnouncement({...good,...change},cfg,descriptor),false);
});
test('terminal does not invent online validators, block heights or mining activity',()=>{
 const boot=renderConsole({role:'buyer',webPort:3000},null);assert.match(boot,/-- \/ 2 online/);assert.match(boot,/Block       --/);assert.doesNotMatch(boot,/mining/i);
 const live=renderConsole({role:'supplier',webPort:3100,localTest:true},{onlineNodes:2,connectedPeers:1,local:{online:true,block:54},consensus:'NETWORK READY',transport:{status:'CONNECTED',address:'100.64.1.2'}});assert.match(live,/Block       #54/);assert.match(live,/TWO PROCESSES/);
});
