import test from 'node:test';
import assert from 'node:assert/strict';
import {isPrivateAddress,validateGateway,validateAnnouncement,relayRpc} from '../scripts/network-client.mjs';
const paired={networkId:'paired-network',genesisHash:'0x1234',validatorKeys:['validator-a','validator-b'],contractAddress:'0xabcd'};
const announcement={protocolVersion:2,networkId:'paired-network',genesisHash:'0x1234',publicKey:'validator-a',deployment:{address:'0xabcd'}};
test('gateway accepts LAN, loopback and private VPN addresses',()=>{
 for(const ip of ['127.0.0.1','192.168.18.2','10.8.0.4','172.16.1.2','100.64.1.2']){assert.ok(isPrivateAddress(ip));assert.equal(validateGateway(`http://${ip}:9050`),`http://${ip}:9050`)}
});
test('gateway rejects public destinations, credentials, alternate protocols and URL paths',()=>{
 for(const url of ['http://8.8.8.8:9050','http://169.254.169.254:9050','https://192.168.1.2:9050','http://user:pass@192.168.1.2:9050','http://192.168.1.2:9050/admin','http://192.168.1.2:9050/?x=1','http://192.168.1.2:80','http://evil.example:9050'])assert.throws(()=>validateGateway(url));
});
test('a matching pinned chain and deployment announcement is accepted',()=>assert.equal(validateAnnouncement(announcement,paired),announcement));
test('another genesis cannot impersonate a chain by reusing its chain ID',()=>assert.throws(()=>validateAnnouncement({...announcement,genesisHash:'0xwrong'},paired)));
test('unknown validators, network IDs and contracts are rejected',()=>{
 for(const change of [{publicKey:'outsider'},{networkId:'other'},{deployment:{address:'0xdead'}},{protocolVersion:1}])assert.throws(()=>validateAnnouncement({...announcement,...change},paired));
});
test('RPC proxy rejects administration, unlocked-account sends and malformed batches before discovery',async()=>{
 for(const payload of [{method:'admin_addPeer'},{method:'personal_sendTransaction'},{method:'eth_sendTransaction'},null,[],[{method:'eth_chainId'},{method:'admin_peers'}],Array(51).fill({method:'eth_chainId'})])assert.equal((await relayRpc(payload)).status,403);
});
