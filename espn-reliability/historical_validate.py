"""Retrospective ESPN play-by-play validation; nonzero exit on missing/invalid data."""
import argparse,json,urllib.request,sys,datetime
from pathlib import Path
ROOT="https://site.api.espn.com/apis/site/v2/sports/"
CASES=[("football/college-football","401856723"),("basketball/nba","AUTO:20261016")]
def load(url):
    req=urllib.request.Request(url,headers={"User-Agent":"HistoricalSportsDataValidation/1.0"})
    with urllib.request.urlopen(req,timeout=25) as response:return json.load(response)
def extract(summary):
    candidates=[]
    top=summary.get("plays")
    if isinstance(top,list):candidates.append(("plays",top))
    if isinstance(top,dict) and isinstance(top.get("plays"),list):candidates.append(("plays.plays",top["plays"]))
    drives=summary.get("drives",{})
    if isinstance(drives,dict):
        for k in ("previous","current"):
            arr=drives.get(k,[])
            if isinstance(arr,dict):arr=[arr]
            if isinstance(arr,list):
                ps=[p for d in arr if isinstance(d,dict) for p in d.get("plays",[]) if isinstance(p,dict)]
                if ps:candidates.append(("drives."+k+".plays",ps))
    return max(candidates,key=lambda kv:len(kv[1])) if candidates else ("NONE",[])
def score_pairs(plays):
    return [(int(p["homeScore"]),int(p["awayScore"])) for p in plays if p.get("homeScore") is not None and p.get("awayScore") is not None]
def main():
    out=Path("historical-validation");out.mkdir(exist_ok=True)
    report=[];failed=False
    for league,event in CASES:
        rec={"league":league,"event":event}
        try:
            root=ROOT+league+"/"
            if event.startswith("AUTO:"):
                day=event.split(":")[1]
                board=load(root+"scoreboard?dates="+day+"&limit=100")
                finals=[e for e in board.get("events",[]) if e.get("status",{}).get("type",{}).get("completed")]
                if not finals: raise RuntimeError("No historical completed events for "+day)
                event=str(finals[0]["id"]);rec["event"]=event
            summary=load(root+"summary?event="+event)
            (out/(league.split("/")[-1]+"_schema.json")).write_text(json.dumps({
                "top_level_keys":list(summary),
                "drives_keys":list(summary.get("drives",{})) if isinstance(summary.get("drives"),dict) else [],
                "plays_type":type(summary.get("plays")).__name__,
                "status":summary.get("header",{}).get("competitions",[{}])[0].get("status",{})
            },indent=2))
            source,plays=extract(summary)
            rec.update(source=source,play_count=len(plays),scored_states=len(score_pairs(plays)))
            rec["sample_play_keys"]=list(plays[0]) if plays else []
            rec["sample_play"]=plays[0] if plays else None
            sc=score_pairs(plays)
            rec["score_states_monotone"]=all(b[0]>=a[0] and b[1]>=a[1] for a,b in zip(sc,sc[1:])) if sc else False
            # Consistency with final scoreboard. Scores can be absent from some play records.
            headers=summary.get("header",{}).get("competitions",[])
            comps=(headers[0].get("competitors",[]) if headers else [])
            rec["final_from_header"]={c.get("homeAway"):c.get("score") for c in comps}
            if sc and len(comps)>=2:
                rec["last_scored_state"]=list(sc[-1])
                try:
                    home=int(rec["final_from_header"]["home"]);away=int(rec["final_from_header"]["away"])
                    rec["final_match"]=sc[-1]==(home,away)
                except Exception:rec["final_match"]=False
            else:rec["final_match"]=False
            rec["pass"]=len(plays)>0 and len(sc)>0 and rec["score_states_monotone"] and rec["final_match"]
        except Exception as exc:
            rec["pass"]=False;rec["error"]=str(exc)
        report.append(rec)
        if not rec["pass"]:failed=True
    (out/"report.json").write_text(json.dumps(report,indent=2))
    md=["# Retrospective ESPN play-by-play verification"]
    for r in report:
        md += ["\n## "+r["league"]+" game "+r["event"],"\n- Pass: **"+str(r["pass"])+"**"]
        for k,v in r.items():
            if k not in ("sample_play",):md.append("- "+k+": "+str(v))
    (out/"report.md").write_text("\n".join(md)+"\n")
    print(json.dumps(report,indent=2))
    if failed:sys.exit(1)
if __name__=="__main__":main()
