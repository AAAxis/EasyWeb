// GSM 03.38 basic alphabet; extension characters consume two septets.
const basic = new Set(Array.from('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'));
const extended = new Set(Array.from('^{}\\[~]|€\f'));
export function smsSegments(body:string, tollFreeNorthAmerica=false) {
  if (!body || body.length>1600) throw new Error('INVALID_SMS_LENGTH');
  const characters=Array.from(body);
  const gsm=characters.every(character=>basic.has(character)||extended.has(character));
  const widths=characters.map(character=>gsm ? (extended.has(character)?2:1) : character.length);
  const units=widths.reduce((total,width)=>total+width,0);
  if(units<=(gsm?160:70)) return 1;
  const limit=gsm?(tollFreeNorthAmerica?152:153):(tollFreeNorthAmerica?66:67);
  let segments=1,used=0;
  for(const width of widths) {
    if(used+width>limit){segments++;used=0;}
    used+=width;
  }
  return segments;
}
export function smsReserveCents(rates:{usd:string}[],segments:number) {
  let maximum=0n;
  for(const rate of rates) {
    if(!/^\d+(\.\d{1,9})?$/.test(rate.usd)) throw Error('INVALID_SMS_RATE');
    const [whole,fraction='']=rate.usd.split('.');
    const nano=BigInt(whole)*1000000000n+BigInt(fraction.padEnd(9,'0'));
    if(nano>maximum) maximum=nano;
  }
  if(maximum===0n) throw Error('SMS_RATE_UNAVAILABLE');
  return Number((maximum*BigInt(segments)*100n+999999999n)/1000000000n);
}
