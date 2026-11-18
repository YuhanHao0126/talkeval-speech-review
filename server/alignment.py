"""Explainable claim alignment for user-confirmed outlines; no LLM calls."""
import math
import re
from collections import Counter


def normalize(text):
    return re.sub(r'[^\w\u4e00-\u9fff]', '', str(text).lower())


def grams(text):
    text = normalize(text)
    return Counter(text[i:i+n] for n in (1,2,3) for i in range(len(text)-n+1))


def cosine(a,b):
    a,b=grams(a),grams(b)
    denominator=math.sqrt(sum(v*v for v in a.values())*sum(v*v for v in b.values()))
    return sum(v*b.get(k,0) for k,v in a.items())/denominator if denominator else 0.0


def align_claims(outline, transcript):
    if not isinstance(transcript,str) or len(transcript)>30000: raise ValueError('转写文本须为字符串且不超过30000字。')
    if not isinstance(outline,list) or not 1<=len(outline)<=20: raise ValueError('提纲须包含1至20条观点。')
    units=[s.strip() for s in re.split(r'[。！？!?\n；;]',transcript) if s.strip()]
    candidates=[('；'.join(units[i:i+n]),i,i+n-1) for i in range(len(units)) for n in (1,2,3) if i+n<=len(units)]
    results=[]
    for index,beat in enumerate(outline):
        if not isinstance(beat,dict):raise ValueError('观点须为JSON对象。')
        title=beat.get('text','');weight=beat.get('weight',1);groups=beat.get('claims',[])
        if not isinstance(title,str) or not title.strip() or len(title)>300:raise ValueError('每条观点需要不超过300字的目标文本。')
        if isinstance(weight,bool) or not isinstance(weight,(int,float)) or not math.isfinite(weight) or not 0<weight<=10:raise ValueError('重要度权重须在0至10之间。')
        if not isinstance(groups,list) or not 1<=len(groups)<=8 or any(not isinstance(g,list) or not 1<=len(g)<=10 or any(not isinstance(s,str) or not s.strip() or len(s)>60 for s in g) for g in groups):raise ValueError('每条观点需要1至8组必要表达，每组提供非空关键词或同义短语。')
        def measure(candidate):
            text,start,end=candidate;clean=normalize(text)
            matched=[next((term for term in group if normalize(term) in clean),None) for group in groups]
            coverage=sum(term is not None for term in matched)/len(groups)
            negated=[term for term in matched if term and re.search(r'(?:不|未|没有|无需|不要|不能|并非|不会)(?:需要|会|再)?'+re.escape(normalize(term)),clean)]
            expected_numbers=re.findall(r'\d+(?:\.\d+)?%?',title)
            observed_numbers=set(re.findall(r'\d+(?:\.\d+)?%?',text))
            number_mismatch=bool(expected_numbers) and any(number not in observed_numbers for number in expected_numbers)
            similarity=cosine(title,text)
            score=.7*coverage+.3*similarity
            if negated or number_mismatch:score*=.5
            return dict(score=score,coverage=coverage,matched=matched,negated=negated,number_mismatch=number_mismatch,similarity=similarity,text=text,start=start,end=end)
        best=max((measure(c) for c in candidates),key=lambda c:c['score'],default=None)
        coverage=best['coverage'] if best else 0
        flagged=bool(best and (best['negated'] or best['number_mismatch']))
        completion=0 if coverage==0 else .5 if coverage<1 or flagged else 1
        results.append(dict(id=beat.get('id',str(index+1)),text=title,weight=weight,completion=completion,
                            status='需复核' if flagged else '完整' if completion==1 else '部分' if completion else '未覆盖',
                            evidence=best['text'] if best and coverage else '',sentence_span=[best['start']+1,best['end']+1] if best and coverage else None,
                            claim_coverage=coverage,similarity=round(best['similarity'],4) if best else 0,
                            missing_claims=[g for g,m in zip(groups,best['matched'] if best else [None]*len(groups)) if m is None],
                            review_reasons=(['命中否定表达'] if best and best['negated'] else [])+(['目标数字未在证据中匹配'] if best and best['number_mismatch'] else [])))
    total=sum(r['weight'] for r in results)
    return dict(weighted_coverage=sum(r['weight']*r['completion'] for r in results)/total,results=results,
                formula='sum(importance × completion) / sum(importance); completion ∈ {0, 0.5, 1}',
                note='字符1至3元组相似度用于候选定位；必要表达组用于覆盖检查。词面规则可能漏掉改述，也不能证明逻辑成立或观众理解；否定和数字冲突需人工复核。')
