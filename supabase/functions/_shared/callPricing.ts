// Integer USD microdollars keep tariff calculations exact until the final cent.
export function usdMicros(value: unknown): number {
  if(typeof value!=='string'||!/^\d+(\.\d{1,6})?$/.test(value)) throw new Error('CALL_PRICE_UNAVAILABLE');
  const [whole,fraction='']=value.split('.');
  const micros=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));
  if(micros>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('CALL_PRICE_UNAVAILABLE');
  return Number(micros);
}
export function retailCents(micros:number):number {
  if(!Number.isSafeInteger(micros)||micros<0)throw new Error('INVALID_CALL_COST');
  return Number((BigInt(micros)*2n+9999n)/10000n);
}
export function callBudget(paid:number,overhead:number,minute:number):number {
  if(!Number.isSafeInteger(paid)||!Number.isSafeInteger(overhead)||!Number.isSafeInteger(minute)||minute<=0)throw new Error('INVALID_CALL_BUDGET');
  return Math.min(14400,Math.max(0,Math.floor((paid-overhead)/minute))*60);
}
export function quotedCallCost(direction:string,pstn:number,sdk:number,parentSeconds:number,childSeconds:number):number {
  for(const duration of [parentSeconds,childSeconds])if(!Number.isSafeInteger(duration)||duration<0)throw new Error('INVALID_CALL_DURATION');
  return retailCents(Math.ceil(parentSeconds/60)*(direction==='outbound'?sdk:pstn)
    +Math.ceil(childSeconds/60)*(direction==='outbound'?pstn:sdk));
}
