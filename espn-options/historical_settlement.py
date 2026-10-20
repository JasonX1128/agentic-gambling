"""Settle the 19 contracts in quote_engine.options against completed ESPN play-by-play.

Research-grade historical payoffs, not official dispute-proof settlement.
Run: python espn-options/historical_settlement.py --nba-date 20261016
"""
import argparse,csv,json,sys,urllib.request
from pathlib import Path
from quote_engine import options

ROOT="https://site.api.espn.com/apis/site/v2/sports/"
def get(url):
    req=urllib.request.Request(url,headers={"User-Agent":"espn-exotic-historical-settlement/1.0"})
    with urllib.request.urlopen(req,timeout=25) as r:return json.load(r)
def period(play):
    v=play.get("period") or {}
    return int(v.get("number",0) if isinstance(v,dict) else v)
def seconds(play):
    v=play.get("clock") or {}
    s=v.get("displayValue","") if isinstance(v,dict) else str(v)
    try:return sum(float(n)*60**i for i,n in enumerate(reversed(s.split(":"))))
    except (ValueError,TypeError):return 0.
def extract(summary,league):
    p=summary.get("plays")
    if isinstance(p,list):return p,"plays"
    if isinstance(p,dict) and isinstance(p.get("plays"),list):return p["plays"],"plays.plays"
    d=summary.get("drives") or {}
    if isinstance(d,dict):
        arr=d.get("previous") or []
        if isinstance(arr,dict):arr=[arr]
        plays=[p for x in arr if isinstance(x,dict) for p in x.get("plays",[]) if isinstance(p,dict)]
        if plays:return plays,"drives.previous.plays"
    return [],"missing"
def reconstruct(raw):
    # chronological period/remaining-clock order; stable tie ordering.
    plays=sorted(raw,key=lambda p:(period(p),-seconds(p)))
    path=[(0.,0.)];period_end={};raw_backwards=[];last=(0.,0.)
    for p in plays:
        if p.get("homeScore") is None or p.get("awayScore") is None:continue
        try:h,a=float(p["homeScore"]),float(p["awayScore"])
        except (ValueError,TypeError):continue
        if h<last[0] or a<last[1]:
            raw_backwards.append({"id":p.get("id"),"period":period(p),"raw":[h,a],"previous":list(last)})
        # Repair transient stale/corrected snapshots without manufacturing negative points.
        h=max(h,last[0]);a=max(a,last[1])
        last=(h,a);path.append(last)
        if period(p)>0:period_end[period(p)]=last
    n=max(4,max(period_end,default=0))
    qh=[];qa=[];before=(0.,0.)
    for q in range(1,n+1):
        after=period_end.get(q,before)
        qh.append(max(0.,after[0]-before[0]));qa.append(max(0.,after[1]-before[1]))
        before=after
    return path,(qh,qa),raw_backwards
def game(league,event,strike):
    s=get(ROOT+league+"/summary?event="+event)
    header=(s.get("header",{}).get("competitions") or [{}])[0]
    comp=header.get("competitors") or []
    home=next((c for c in comp if c.get("homeAway")=="home"),None)
    away=next((c for c in comp if c.get("homeAway")=="away"),None)
    if not home or not away:raise ValueError("missing home/away competitors")
    status=header.get("status") or {}
    # also accept event status fields in older ESPN shapes; require final score and final status
    final=status.get("type",{}).get("completed") or status.get("type",{}).get("name")=="STATUS_FINAL"
    if not final:raise ValueError("not a completed game: "+str(status))
    raw,source=extract(s,league)
    if not raw:raise ValueError("no historical play-by-play")
    path,quarters,backwards=reconstruct(raw)
    official=(float(home["score"]),float(away["score"]))
    if path[-1]!=official:raise ValueError("last reconstructed score "+str(path[-1])+" != official "+str(official))
    pays=options(path,strike,quarters)
    names=lambda c:c.get("team",{}).get("abbreviation",c.get("team",{}).get("displayName","?"))
    meta={"league":league,"event_id":event,"matchup":names(away)+" @ "+names(home),
          "home":names(home),"away":names(away),"official_home":official[0],
          "official_away":official[1],"source":source,"plays":len(raw),
          "backward_score_snapshots":len(backwards),"path_states":len(path),
          "low_home_margin":min(h-a for h,a in path),"high_home_margin":max(h-a for h,a in path),
          "quarter_home":quarters[0],"quarter_away":quarters[1],
          "warning":"Historical ESPN event scores; max-envelope correction for backward snapshots; average_margin is per-play, not time-weighted."}
    return meta,pays,backwards
def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--nba-date",default="20261016")
    ap.add_argument("--cfb-event",default="401856723")
    ap.add_argument("--nba-limit",type=int,default=20)
    ap.add_argument("--strict",action="store_true",help="Fail when any game is missing or invalid")
    args=ap.parse_args()
    out=Path("settlement-results");out.mkdir(exist_ok=True)
    cases=[("football/college-football",args.cfb_event,50)]
    board=get(ROOT+"basketball/nba/scoreboard?dates="+args.nba_date+"&limit=100")
    events=[e for e in board.get("events",[]) if e.get("status",{}).get("type",{}).get("completed")]
    cases += [("basketball/nba",str(e["id"]),225) for e in events[:args.nba_limit]]
    if len(cases)<2:raise RuntimeError("No completed NBA games found for "+args.nba_date)
    rows=[];diagnostics=[];failures=[]
    for league,event,strike in cases:
        try:
            meta,pays,backwards=game(league,event,strike)
            diagnostics.append(dict(meta,backward_examples=backwards[:15]))
            rows.extend(dict(event_id=event,league=league,matchup=meta["matchup"],
                         option=name,payoff=round(float(value),6),
                         strike_total=strike,backward_snapshots=len(backwards))
                        for name,value in pays.items())
            print("OK",meta["matchup"],"plays",meta["plays"],"payoffs",len(pays),flush=True)
        except Exception as exc:
            failures.append({"league":league,"event":event,"error":str(exc)})
            print("FAIL",league,event,str(exc),flush=True)
    (out/"diagnostics.json").write_text(json.dumps({"games":diagnostics,"failures":failures},indent=2))
    if rows:
        with (out/"settlements.csv").open("w",newline="") as f:
            w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
        (out/"settlements.json").write_text(json.dumps(rows,indent=2))
    txt=["# Historical ESPN exotic option settlements","",
         "Payoffs use the 19 existing contract definitions in espn-options/quote_engine.py.",
         "The contract definitions are illustrative, not exchange specifications.",
         "Historical NBA scores come from completed game summaries; football is a pipeline sanity check.",
         "Scores are sorted by period and clock, then transient backward scores are clamped to the last observed score.",
         "This may conceal true corrections. Do not use for cash settlement without independent validation.",
         "The 'average_margin_home_call_K0' is **play-event-weighted**, not elapsed-time-weighted.",
         "Quarter-derived contracts use score differences between observed end-of-period states.",
         "Out-of-order ties and missing quarter-end plays could alter settlements.","",
         "Games succeeded: "+str(len(diagnostics))+"; failures: "+str(len(failures))+".","",
         "## Games"]
    for d in diagnostics:
        txt.append("- "+d["matchup"]+" ("+d["league"]+"): "+str(d["plays"])+" plays; "+str(d["backward_score_snapshots"])+" clamped snapshots")
    for x in failures:txt.append("- ERROR "+str(x))
    (out/"README.md").write_text("\n".join(txt)+"\n")
    if not rows or (args.strict and failures):sys.exit(1)
if __name__=="__main__":main()
