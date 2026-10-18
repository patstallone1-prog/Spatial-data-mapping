import SunCalc from './vendor/suncalc-1.9.0.mjs';
export const WEATHER=Object.freeze({
  // wind: m/s from windFrom degrees -- San Francisco's sea breeze, a fresh 5-7 m/s from the
  // west-north-west most afternoons (NWS SFO normals), stronger in a front. A preview, not live.
  sunny:{cloud:0.05,turbidity:2,sun:1,rain:0,wind:4.5,windFrom:290},
  partly_cloudy:{cloud:.42,turbidity:4,sun:.8,rain:0,wind:6,windFrom:290},
  cloudy:{cloud:.9,turbidity:10,sun:.25,rain:0,wind:6.5,windFrom:270},
  rain:{cloud:.98,turbidity:14,sun:.12,rain:1,wind:9.5,windFrom:200},
});
export function solarState(date,lat,lon) {
  const p=SunCalc.getPosition(date,lat,lon),c=Math.cos(p.altitude);
  // SunCalc azimuth starts at south. Renderer east=+X, north=-Z.
  return {altitude:p.altitude,direction:[-Math.sin(p.azimuth)*c,Math.sin(p.altitude),Math.cos(p.azimuth)*c],
    localTime:new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(date)};
}
export function previewTime(name,now,lat,lon) {
  if(name==='live')return null;
  const times=SunCalc.getTimes(now,lat,lon);
  const key={dawn:'dawn',noon:'solarNoon',dusk:'dusk',night:'nadir'}[name];
  if(!key)throw Error('Unknown time preview');
  return times[key];
}
