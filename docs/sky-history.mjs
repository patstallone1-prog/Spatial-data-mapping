// The weather that was: when the sky is set to another hour (the compass's sun arc), it takes the
// conditions a National Weather Service station observed then -- public-domain METAR reports from
// api.weather.gov, the nearest airport station to the page -- rather than a preset. An hour that
// has not happened yet takes the previous day's weather at that hour (and so on back), since a
// forecast is not an observation. Nothing here is guessed: no observation, no change.
import {WEATHER} from './sky-clock.mjs';

const API = 'https://api.weather.gov';
const HOUR = 3600000, DAY = 24 * HOUR;
//: How near an observation must be to the hour asked for.
const NEAR = 90 * 60000;

//: A METAR's sky -- its cloud layers, the station's description, its rain -- as the page's
//: weather preset, and its wind in m/s from degrees. Null when it reports no sky.
export function conditionsOf(p) {
  const text = String(p.textDescription || '');
  const rank = {SKC: 0, CLR: 0, FEW: 1, SCT: 2, BKN: 3, OVC: 4, VV: 4};
  const layers = (p.cloudLayers || []).map(c => rank[c.amount]).filter(Number.isFinite);
  const wet = (p.precipitationLastHour?.value || 0) > 0 || /rain|drizzle|shower|thunder/i.test(text);
  if (!layers.length && !text && !wet) return null;
  const cover = layers.length ? Math.max(...layers) : (/cloudy|overcast/i.test(text) ? 3 : 0);
  const preset = wet ? 'rain' : /fog|mist/i.test(text) || cover >= 3 ? 'cloudy' : cover === 2 ? 'partly_cloudy' : 'sunny';
  const kmh = p.windSpeed?.value, from = p.windDirection?.value;
  return {
    preset,
    wind: Number.isFinite(kmh) ? kmh / 3.6 : WEATHER[preset].wind,
    windFrom: Number.isFinite(from) ? from : WEATHER[preset].windFrom,
    text,
  };
}

//: The instant whose observed weather stands for `date`: itself if it has passed, else the
//: same hour the day before (or before that), so a future hour shows yesterday's weather.
export function observedInstant(date, now = Date.now()) {
  let t = +date;
  while (t > now) t -= DAY;
  return t;
}

export function createWeatherHistory(lat, lon, fetcher = globalThis.fetch?.bind(globalThis)) {
  let station = null;
  const hours = new Map();
  async function json(url) {
    const response = await fetcher(url, {headers: {Accept: 'application/geo+json'}});
    if (!response.ok) throw Error(`weather.gov ${response.status}`);
    return response.json();
  }
  function nearestStation() {
    station ??= json(`${API}/points/${lat.toFixed(4)},${lon.toFixed(4)}`)
      .then(point => json(point.properties.observationStations))
      .then(list => {
        // An airport (ICAO K...) reports cloud layers; the city's own sensors often do not.
        const ids = list.features.map(f => f.properties.stationIdentifier);
        return ids.find(id => /^K[A-Z0-9]{3}$/.test(id)) || ids[0];
      });
    station.catch(() => { station = null; });
    return station;
  }
  //: The observed conditions standing for `date`, with when and where they were observed.
  async function at(date, now = Date.now()) {
    const t = observedInstant(date, now);
    const key = Math.floor(t / HOUR);
    if (!hours.has(key)) {
      const promise = nearestStation().then(id => json(`${API}/stations/${id}/observations?start=${
        new Date(t - NEAR).toISOString().replace(/\.\d+Z$/, 'Z')}&end=${new Date(t + NEAR).toISOString().replace(/\.\d+Z$/, 'Z')}`)
        .then(data => {
          let best = null;
          for (const f of data.features || []) {
            const c = conditionsOf(f.properties);
            const off = Math.abs(Date.parse(f.properties.timestamp) - t);
            if (c && off <= NEAR && (!best || off < best.off)) best = {...c, off, observed: f.properties.timestamp, station: id};
          }
          return best;
        }));
      promise.catch(() => hours.delete(key));
      hours.set(key, promise);
    }
    const found = await hours.get(key);
    return found && {...found, standsIn: t !== +date};
  }
  return {at};
}
