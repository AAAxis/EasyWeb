const messages:Record<string,[string,string]>={
 en:['Number expires in 1 day','{number} expires in 1 day. Keep {price} in your balance to renew automatically; otherwise the number will be released.'],
 he:['המספר יפוג בעוד יום','תוקף המספר {number} יפוג בעוד יום. השאירו {price} ביתרה לחידוש אוטומטי; אחרת המספר ישוחרר.'],
 ar:['تنتهي صلاحية الرقم خلال يوم','تنتهي صلاحية {number} خلال يوم. احتفظ بـ {price} في رصيدك للتجديد تلقائيًا، وإلا فسيتم تحرير الرقم.'],
 de:['Nummer läuft in 1 Tag ab','{number} läuft in 1 Tag ab. Halte {price} Guthaben für die automatische Verlängerung bereit, sonst wird die Nummer freigegeben.'],
 es:['El número vence en 1 día','{number} vence en 1 día. Mantén {price} de saldo para renovar automáticamente; de lo contrario, se liberará el número.'],
 fr:['Le numéro expire dans 1 jour','{number} expire dans 1 jour. Gardez {price} de solde pour le renouvellement automatique, sinon le numéro sera libéré.'],
 pt:['O número expira em 1 dia','{number} expira em 1 dia. Mantenha {price} de saldo para renovar automaticamente; caso contrário, o número será liberado.'],
 ru:['Номер истекает через 1 день','Срок действия {number} истекает через 1 день. Оставьте {price} на балансе для автопродления, иначе номер будет освобождён.'],
 tr:['Numaranın süresi 1 gün sonra doluyor','{number} için süre 1 gün sonra doluyor. Otomatik yenileme için bakiyenizde {price} bulundurun; aksi halde numara serbest bırakılır.'],
 hi:['नंबर की अवधि 1 दिन में समाप्त होगी','{number} की अवधि 1 दिन में समाप्त होगी। अपने आप नवीनीकरण के लिए बैलेंस में {price} रखें, नहीं तो नंबर छोड़ दिया जाएगा।'],
 ja:['電話番号の有効期限まであと1日','{number}は1日後に期限切れになります。自動更新には残高{price}が必要です。不足している場合、番号は解約されます。'],
 ko:['전화번호 만료까지 1일','{number}는 1일 후 만료됩니다. 자동 갱신을 위해 잔액 {price}를 유지하세요. 잔액이 부족하면 번호가 해지됩니다.'],
 zh:['号码将在1天后到期','{number}将在1天后到期。请保留{price}余额以自动续租，否则号码将被释放。'],
};
export function rentalWarningText(locale:string|undefined,number:string,cents:number) {
 const [title,template]=messages[String(locale??'en').split(/[-_]/)[0]]??messages.en;
 return {title,body:template.replace('{number}',number).replace('{price}',`$${(cents/100).toFixed(2)}`)};
}
