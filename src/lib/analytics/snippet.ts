const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The counter a published site carries: one small message per page view, with the path, the
 * referrer and the utm_medium of the link. No cookies and no storage, and nothing is sent when the
 * visitor has asked their browser not to be tracked. Pages that change address without a reload
 * (single-page apps) are counted when the address changes.
 */
export function trackingSnippet(origin: string, projectId: string): string {
  if (!UUID.test(projectId) || !/^https:\/\/[\w.-]+(?::\d+)?$/.test(origin)) return "";
  const config = JSON.stringify({ u: `${origin}/api/collect`, s: projectId });
  return `<script>(function(){try{if(navigator.doNotTrack==="1"||window.doNotTrack==="1")return;var c=${config};var last="";function send(){var p=location.pathname;if(p===last)return;last=p;var m=new URLSearchParams(location.search).get("utm_medium")||"";var b=JSON.stringify({s:c.s,p:p,r:document.referrer,m:m});if(navigator.sendBeacon){navigator.sendBeacon(c.u,new Blob([b],{type:"text/plain"}))}else{fetch(c.u,{method:"POST",body:b,keepalive:true,mode:"no-cors"})}}var h=history.pushState;history.pushState=function(){h.apply(this,arguments);setTimeout(send,0)};addEventListener("popstate",send);send()}catch(e){}})()</script>`;
}
