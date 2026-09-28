import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySipCall, parseSipUri, toE164, maskNumber } from '../supabase/functions/_shared/sipRouting.ts';

const config = { domain: 'easycall-voip.sip.twilio.com', carrierIps: ['46.19.214.14'] };
const common = { AccountSid: 'AC00000000000000000000000000000000', Direction: 'inbound' };

test('the rejected Zoiper call (CA674d…f487) is an outgoing endpoint call to +972515473526', () => {
  const call = classifySipCall({
    ...common,
    CallSid: 'CA674d246bd495b546c20724e32f3df487',
    From: 'sip:easycall_didww@easycall-voip.sip.twilio.com;transport=UDP',
    To: 'sip:+972515473526@easycall-voip.sip.twilio.com;transport=UDP',
    SipDomainSid: 'SD00000000000000000000000000000000',
  }, config);
  assert.deepEqual(call, { kind: 'endpoint', username: 'easycall_didww', destination: '+972515473526' });
});

test('DIDWW delivering a call to +6531072402 stays an incoming carrier call', () => {
  const call = classifySipCall({
    ...common,
    From: 'sip:6531061544@46.19.214.14',
    To: 'sip:6531072402@easycall-voip.sip.twilio.com',
    SipSourceIp: '46.19.214.14',
  }, config);
  assert.deepEqual(call, { kind: 'carrier' });
});

test('a carrier IP is never treated as a softphone, even with a From on our domain', () => {
  const call = classifySipCall({
    ...common,
    From: 'sip:easycall_didww@easycall-voip.sip.twilio.com',
    To: 'sip:+972515473526@easycall-voip.sip.twilio.com',
    SipSourceIp: '46.19.214.14',
  }, config);
  assert.equal(call.kind, 'carrier');
});

test('a PSTN call to a Twilio number is untouched', () => {
  assert.deepEqual(classifySipCall({ ...common, From: '+6531061544', To: '+6531072402' }, config), { kind: 'pstn' });
});

test('a call from another SIP domain is refused when the domain SID is pinned', () => {
  const call = classifySipCall({
    ...common,
    From: 'sip:easycall_didww@easycall-voip.sip.twilio.com',
    To: 'sip:+972515473526@easycall-voip.sip.twilio.com',
    SipDomainSid: 'SDother',
  }, { ...config, domainSid: 'SDours' });
  assert.deepEqual(call, { kind: 'reject', reason: 'SIP_DOMAIN_MISMATCH' });
});

test('an endpoint dialling something that is not a number gets no destination', () => {
  for (const dialled of ['*97', '123', 'voicemail', '%2B97251547352%3B']) {
    const call = classifySipCall({
      ...common,
      From: 'sip:easycall_didww@easycall-voip.sip.twilio.com',
      To: `sip:${dialled}@easycall-voip.sip.twilio.com`,
    }, config);
    assert.equal(call.kind, 'endpoint');
    assert.equal(call.destination, null, dialled);
  }
});

test('SIP URIs are parsed in the shapes Twilio forwards', () => {
  assert.deepEqual(parseSipUri('sip:%2B972515473526@Easycall-Voip.sip.twilio.com:5060;transport=UDP'),
    { user: '+972515473526', host: 'easycall-voip.sip.twilio.com' });
  assert.deepEqual(parseSipUri('"Dima" <sips:easycall_didww@easycall-voip.sip.twilio.com>;tag=1'),
    { user: 'easycall_didww', host: 'easycall-voip.sip.twilio.com' });
  for (const bad of ['', '+972515473526', 'client:abc', 'sip:@host', 'sip:nohost', 'sip:%E0%A4%A@host']) {
    assert.equal(parseSipUri(bad), null, bad);
  }
});

test('dialled strings normalise to E.164 or are refused', () => {
  assert.equal(toE164('+972515473526'), '+972515473526');
  assert.equal(toE164('00972515473526'), '+972515473526');
  assert.equal(toE164('972515473526'), '+972515473526');
  assert.equal(toE164('+65 3107-2402'), '+6531072402');
  for (const bad of ['', '0515473526x', '+0972515473526', '+1234567', '+1234567890123456', '*972515473526', '972#1']) {
    assert.equal(toE164(bad), null, bad);
  }
});

test('logged numbers are masked', () => {
  assert.equal(maskNumber('+972515473526'), '+972…26');
  assert.equal(maskNumber(null), '');
});
