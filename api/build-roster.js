import dns from 'node:dns/promises';
import net from 'node:net';
import * as cheerio from 'cheerio';

function send(res,status,body){res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(body))}
async function body(req){if(req.body&&typeof req.body==='object')return req.body;if(typeof req.body==='string')return JSON.parse(req.body||'{}');let s='';for await(const c of req){s+=c;if(s.length>100000)throw new Error('Request too large.')}return s?JSON.parse(s):{}}
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const abs=(v,b)=>{try{return v?new URL(v,b).href:''}catch{return''}};
function isPrivate(ip){if(!net.isIP(ip))return true;if(ip==='::1'||ip==='0.0.0.0')return true;if(/^(10|127|169\.254|192\.168)\./.test(ip))return true;const m=ip.match(/^172\.(\d+)\./);if(m&&+m[1]>=16&&+m[1]<=31)return true;return /^(fc|fd|fe80:)/i.test(ip)}
async function safeUrl(raw){let u;try{u=new URL(raw)}catch{throw new Error('Enter a valid roster URL.')}if(!/^https?:$/.test(u.protocol)||u.username||u.password)throw new Error('That URL is not allowed.');const r=await dns.lookup(u.hostname,{all:true});if(!r.length||r.some(x=>isPrivate(x.address)))throw new Error('That roster host is not publicly reachable.');return u}

function label(text,name,next){
  const esc=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const stop=next||'(?:Position|Academic Year|Class|Height|Weight|Custom Field 1|Hometown|Last School|Previous School|Full Bio|Expand)';
  const m=text.match(new RegExp(`${esc}\\s*:?\\s*(.*?)\\s*(?=${stop}|$)`,'i'));
  return m?clean(m[1]):'';
}
function parsePlayers(html,base){
  const $=cheerio.load(html);
  const out=[],seen=new Set();
  const links=$('a[href*="/sports/football/roster/"],a[href*="/roster/"]');
  links.each((_,a)=>{
    const $a=$(a), href=$a.attr('href')||'', atext=clean($a.text());
    if(!href||!atext||/jersey number|full bio|expand/i.test(atext))return;
    let box=$a.closest('.sidearm-roster-player,li[class*="roster"],div[class*="roster-player"],article,tr');
    if(!box.length)box=$a.parent();
    const text=clean(box.text());
    if(!/Position/i.test(text)||!/(Academic Year|Class)/i.test(text))return;
    const number=(text.match(/Jersey Number\s*(\d{1,3})/i)||text.match(/^\s*#?(\d{1,3})\b/)||[])[1]||'';
    let name=atext.replace(/^Jersey Number\s*\d+\s*/i,'').replace(/^Full Bio for\s*/i,'').trim();
    if(!name||name.length>100)return;
    const position=label(text,'Position');
    const cls=label(text,'Academic Year')||label(text,'Class');
    const height=label(text,'Height');
    const weight=label(text,'Weight').replace(/\s*lbs?\.?$/i,'');
    const hometown=label(text,'Hometown');
    const previousSchool=label(text,'Last School')||label(text,'Previous School');
    const img=box.find('img').first();
    const image=abs(img.attr('data-src')||img.attr('data-original')||img.attr('data-lazy-src')||img.attr('src')||'',base);
    const profile=abs(href,base);
    const key=`${number}|${name.toLowerCase()}`;if(seen.has(key))return;seen.add(key);
    out.push({number,name,position,class:cls,height,weight,hometown,previousSchool,image,profile,bio:''});
  });
  return out;
}
async function enrich(players,limit=120){
  let i=0;
  const workers=Array.from({length:6},async()=>{
    while(i<Math.min(players.length,limit)){
      const idx=i++,p=players[idx];if(!p.profile)continue;
      try{
        const r=await fetch(p.profile,{headers:{'user-agent':'Mozilla/5.0','accept':'text/html'}});
        if(!r.ok)continue;const html=await r.text(),$=cheerio.load(html);
        if(!p.image){const im=$('meta[property="og:image"]').attr('content')||$('img[class*="bio"]').first().attr('src');p.image=abs(im,p.profile)}
        const bio=clean($('.sidearm-roster-player-bio, .s-person-details, article').first().text());
        if(bio)p.bio=bio.slice(0,1200);
      }catch{}
    }
  });
  await Promise.all(workers);return players;
}
export default async function handler(req,res){
  if(req.method==='GET')return send(res,200,{ok:true,service:'ncaa-roster-builder',version:'1.1'});
  if(req.method!=='POST')return send(res,405,{error:'Method not allowed.'});
  try{
    const b=await body(req),u=await safeUrl(b.url);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    let r;try{r=await fetch(u,{redirect:'follow',signal:controller.signal,headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36','accept':'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.9'}})}finally{clearTimeout(timer)}
    if(!r.ok)return send(res,502,{error:`Roster website returned HTTP ${r.status}.`});
    const html=await r.text(),base=r.url||u.href;
    let players=parsePlayers(html,base);
    if(!players.length)return send(res,422,{error:'The page loaded, but no football roster players were recognized.'});
    if(b.fetchProfiles)players=await enrich(players);
    return send(res,200,{source:base,count:players.length,players});
  }catch(e){return send(res,400,{error:e?.name==='AbortError'?'The roster website took too long to respond.':e?.message||'Roster build failed.'})}
}
