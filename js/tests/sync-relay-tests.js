import {normalizeRelayEndpoint,validateRelayWorkspaceId} from '../services/sync-relay.js';

const rejects=fn=>{try{fn()}catch(error){return error}throw new Error('Expected value to be rejected')};

export function runSyncRelayTests(test,expect){
 test('Relay config: canonicalizes secure HTTPS base URLs without query or fragment',()=>{
  expect(normalizeRelayEndpoint('https://sync.example.org/office///')).toBe('https://sync.example.org/office');
  expect(normalizeRelayEndpoint('https://sync.example.org/')).toBe('https://sync.example.org');
 });
 test('Relay config: permits HTTP only on localhost for development',()=>{
  expect(normalizeRelayEndpoint('http://localhost:8787/relay')).toBe('http://localhost:8787/relay');
  expect(normalizeRelayEndpoint('http://127.0.0.1:8787/')).toBe('http://127.0.0.1:8787');
  expect(Boolean(rejects(()=>normalizeRelayEndpoint('http://sync.example.org')))).toBe(true);
 });
 test('Relay config: rejects credentials, query parameters, fragments, and unsafe schemes',()=>{
  for(const value of ['https://user:pass@sync.example.org','https://sync.example.org/?token=x','https://sync.example.org/#fragment','javascript:alert(1)','file:///tmp/relay'])expect(Boolean(rejects(()=>normalizeRelayEndpoint(value)))).toBe(true);
 });
 test('Relay config: workspace IDs are bounded and URL-safe',()=>{
  expect(validateRelayWorkspaceId('office_workspace_2026')).toBe('office_workspace_2026');
  for(const value of ['short','has space in it','../other','x'.repeat(121),''])expect(Boolean(rejects(()=>validateRelayWorkspaceId(value)))).toBe(true);
 });
}
