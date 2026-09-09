"use client";

// The VoIP service. Same Supabase project as the CRM, different function: this
// one only knows about calls, numbers, recordings and SMS.
export const VOIP_URL = "https://skembiloeumcibtdghzm.supabase.co/functions/v1/voip";

// The same Firebase project the phone app signs in to, on purpose — one
// account, whichever end you use.
export const FIREBASE_KEY = "AIzaSyDQp2BNR5_NzuO3xdCaHiiqHOrrKQejiM4";

export const REFRESH_STORAGE = "easycall_refresh_token";
