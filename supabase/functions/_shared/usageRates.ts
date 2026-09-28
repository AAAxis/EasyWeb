import { credsFor } from './providers/twilioAccount.ts';
import { HttpError } from './http.ts';

export function doubledRate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d+(\.\d{1,9})?$/.test(value)) return null;
  const [whole, fraction=''] = value.split('.');
  const scale = 10n ** BigInt(fraction.length);
  const doubled = (BigInt(whole)*scale+BigInt(fraction||'0'))*2n;
  return fraction.length ? `${doubled/scale}.${String(doubled%scale).padStart(fraction.length,'0')}` : String(doubled);
}

export async function usageRates(orgId: number, country: string) {
  if (!/^[A-Z]{2}$/.test(country)) throw new HttpError(400,'Choose a country.','INVALID_COUNTRY');
  const creds = await credsFor(orgId);
  if (!creds) throw new HttpError(503,'Prices are temporarily unavailable.','PRICES_UNAVAILABLE');
  const get = async(path: string) => {
    const response=await fetch(`https://pricing.twilio.com/${path}/Countries/${country}`,{
      headers:{Authorization:creds.bearer?`Bearer ${creds.bearer}`:`Basic ${btoa(`${creds.authUser??creds.accountSid}:${creds.authToken}`)}`},
      signal:AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new HttpError(503,'Prices are temporarily unavailable.','PRICES_UNAVAILABLE');
    const body=await response.json();
    if(String(body.price_unit).toUpperCase()!=='USD')throw new HttpError(503,'USD prices are unavailable.','PRICES_UNAVAILABLE');
    return body;
  };
  const [voice,sms]=await Promise.allSettled([get('v2/Voice'),get('v1/Messaging')]);
  if(voice.status==='rejected'&&sms.status==='rejected')throw new HttpError(503,'Prices are temporarily unavailable.','PRICES_UNAVAILABLE');
  const calls=voice.status==='fulfilled' ? (voice.value.outbound_prefix_prices??voice.value.outbound_call_prices??[]).map((p:any)=>({label:p.friendly_name??'Calls',origination_prefixes:p.origination_prefixes??[],destination_prefixes:p.destination_prefixes??[],usd:doubledRate(p.current_price)})).filter((p:any)=>p.usd!==null):null;
  const texts=sms.status==='fulfilled' ? (sms.value.outbound_sms_prices??[]).flatMap((p:any)=>(p.prices??[]).map((rate:any)=>({label:p.carrier??'SMS',number_type:rate.number_type,usd:doubledRate(rate.current_price)}))).filter((p:any)=>p.usd!==null):null;
  const incomingCalls=voice.status==='fulfilled'?(voice.value.inbound_call_prices??[]).map((p:any)=>({label:p.number_type,usd:doubledRate(p.current_price)})).filter((p:any)=>p.usd!==null):null;
  const incomingSms=sms.status==='fulfilled'?(sms.value.inbound_sms_prices??[]).map((p:any)=>({label:p.number_type,usd:doubledRate(p.current_price)})).filter((p:any)=>p.usd!==null):null;
  return {country,currency:'USD',calls,sms:texts,incoming_calls:incomingCalls,incoming_sms:incomingSms,updated_at:new Date().toISOString()};
}
