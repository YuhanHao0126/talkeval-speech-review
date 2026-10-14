from pathlib import Path
import json, sys, subprocess, base64, textwrap, html, shutil
from concurrent.futures import ThreadPoolExecutor

import imageio_ffmpeg
FFMPEG=imageio_ffmpeg.get_ffmpeg_exe()
ROOT=Path(__file__).resolve().parents[1]
DEMO=ROOT.parent
OUT=ROOT/'dist/visuals'
OUT.mkdir(exist_ok=True)

# Editorial labels summarize the existing core points, preserving the complete source in the review.
NOTES={
'speech_001_ai_work':[
('从职责到任务','用 AI 将招聘广告中的职责描述，与 O*Net 的具体工作任务匹配。','职责 → 任务'),
('计算职业暴露度','汇总 125 万个工作岗位，按任务出现频率加权，计算职业的 AI 暴露度。','125 万 · 加权汇总'),
('专业判断更重要','AI 为理财与诊断提供辅助，是否采纳建议仍需专业人士判断。','AI 辅助 · 人来判断'),
('做 AI 的管理者','把 AI 作为助手来管理和使用，自主性成为高效工作的关键能力。','自主性 · 管理助手')],
'speech_002_pressure_white_hair':[
('皮肤也感受着生活','睡眠、饮食、心情与环境，都可能影响皮肤健康。','环境 + 生活习惯'),
('用实验检验假说','阻断小鼠压力激素分泌，再施加压力，观察是否出现白发。','干预 → 施压 → 观察'),
('结果，推翻了预想','研究结果没有支持此前关于精神压力与白发的两种假说。','假说 ≠ 实验结果'),
('追问背后的机制','研究希望理解白发形成机制，最终帮助人们保持乌黑头发。','理解机制 → 改善生活')],
'speech_003_college_students':[
('把成功也记下来','除了回顾失败，也常常想起自己曾经做得不错的事情。','不只复盘失败'),
('这真是我的选择吗','保研、考公与进大厂，有时来自他人对“好未来”的定义。','他人期待 / 自己想要'),
('给情绪一个名字','悲伤、担忧、不满、委屈，需要被准确分辨与表达。','分辨 → 命名 → 表达'),
('想做好，所以会难过','情绪问题不等于不上进；年轻人对自己的要求并未降低。','进取心仍然存在')],
'speech_004_whales':[
('已经消失的身影','白鱀豚已功能性灭绝，演讲者进入研究领域时已难以见到。','保护，不能等'),
('用照片识别种群','泰国湾与涠洲岛虽时间吻合，照相识别却未发现同一头鲸。','时间吻合 ≠ 同一群体'),
('从身体寻找线索','搁浅鲸的脂肪层只有 1 厘米，正常应有 4–5 厘米。','1 cm / 4–5 cm'),
('把保护做在前面','建立搁浅救助网络，也把保护行动推进到搁浅发生之前。','提前保护 → 及时救助')],
'speech_005_climate':[
('舒适天气并不均匀','少数地区的气候舒适日数可达 140 天以上，甚至超过 200 天。','少数地区的“幸运”'),
('多数城市的现实','2022 年，我国绝大多数城市的舒适天数约为 70–140 天。','70–140 天'),
('睡眠被慢慢打扰','部分纬度地区每年损失接近 10 小时睡眠，干扰具有持续性。','慢性、持续的影响'),
('从需求侧找潜力','演讲引用 IPCC 结论：减排潜力的 40%–70% 可来自需求侧。','40%–70% · 需求侧')],
'speech_auto_1fbefa7db3':[
('身体在索要能量','生长阶段的大脑需要更多能量，食物选择并非只是意志问题。','生长 · 能量需求'),
('甜度会越要越高','糖和脂肪的反复刺激，可能让大脑需要更强刺激才满足。','反复刺激 → 更高需求'),
('包装也会触发食欲','鲜艳颜色、食物图片与卡通形象，让人未拆包装就期待食物。','视觉线索 → 食物期待'),
('读懂酸奶营养表','演讲举例：添加糖加上乳糖，会反映在碳水化合物含量中。','添加糖 + 乳糖')],
'speech_auto_594f9836f9':[
('必须不停上进吗','优绩社会把持续上进视为常态，也让个人承担失败的压力。','上进标准 · 私人压力'),
('痛苦也来自结构','当外部的结构性处境难以改变，人们会转而加固内心。','外部处境 → 内心应对'),
('人格也被要求优化','人们在不同场景里逼迫自己积极开放，证明自己足够好。','被要求的“正能量”'),
('让情绪引领发现','情绪不只是需要解决的问题，也可以帮助我们认识自己。','情绪 → 发现自己')],
'speech_auto_65540d2c8f':[
('一次颠覆性的发现','演讲回顾：研究首次证明恶性癌症也能尝试用化学药物治疗。','手术、放疗之外'),
('没有坐等标准治疗','斯坦曼了解胰腺癌的凶险，选择探索新的治疗路径。','面对凶险，主动探索'),
('至少八种创新尝试','除自己的新疗法外，他还尝试了七位科学家提出的七种疗法。','1 + 7 ≥ 8'),
('追问有效成分','演讲以砒霜相关研究为例，讨论复方中的有效成分。','回到研究证据')],
'speech_auto_7e27718c13':[
('给试错留一点空间','中职教学没有同样紧张的高考节奏，也能给学生成长空间。','宽松氛围 → 试错空间'),
('另一条升学路径','3+2 中高职衔接：三年中职之后衔接两年高职学习。','3 年 + 2 年'),
('看见成绩背后的经历','家庭、霸凌与学习障碍等经历，可能是学业薄弱背后的原因。','经历是原因，成绩是结果'),
('找到愿意投入的事','理想的职业教育，应帮助每个年轻人找到热爱并愿意投入的事。','热爱 → 投入 → 享受')],
'speech_auto_c2c143e546':[
('从分享开始','开场表达来到现场与大家分享的意愿。原转写句子尚不完整。','开场片段 · 待复核'),
('回望取得的成就','原转写提及取得更高成就，需结合视频确认完整含义。','经历回顾 · 待复核'),
('关于 100 米的片段','转写“只有100米一样用”含义不完整，回看片段核对原话。','转写待核对'),
('关于自身表现的片段','转写提及“不是那么强”，需结合前后文理解表达意图。','上下文待核对')],
}

def resolve_video(cid):
    folder=DEMO/'real_data/incoming'/cid
    metadata=json.loads((folder/'metadata.json').read_text(encoding='utf-8'))
    p=folder/metadata['video_file']
    if p.stat().st_size<1024:
        target=p.read_text(encoding='utf-8').strip()
        p=(p.parent/target).resolve()
    if not p.exists():
        p=DEMO.parent/'video'/p.name
    if not p.exists() or p.stat().st_size<10000:
        raise RuntimeError(f'Source video unavailable: {cid}: {p}')
    return p

jobs=[]
manifest={}
for p in sorted((ROOT/'dist/data/cases').glob('*.json')):
    cid=p.stem
    data=json.loads(p.read_text(encoding='utf-8'))
    folder=OUT/cid;folder.mkdir(exist_ok=True)
    video=resolve_video(cid)
    slides={d['beat_id']:d for d in data.get('slide_analysis',{}).get('decisions',[])}
    rows=[]
    for i,d in enumerate(data['alignment']['decisions']):
        span=d.get('actual_time_span')
        if not span: continue
        t=round((span[0]+span[1])/2,2)
        slide=slides.get(d['beat_id'],{})
        ppt_t=slide.get('best_frame_timestamp')
        title,summary,keywords=NOTES[cid][i]
        row={'beat_id':d['beat_id'],'time':t,'start':span[0],'frame_url':f'./visuals/{cid}/{d["beat_id"]}.jpg','note_title':title,'note_summary':summary,'keywords':keywords}
        jobs.append((video,t,folder/f'{d["beat_id"]}.jpg'))
        if isinstance(ppt_t,(int,float)) and slide.get('best_frame_text'):
            row.update(ppt_time=ppt_t,ppt_url=f'./visuals/{cid}/{d["beat_id"]}-ppt.jpg',ppt_label=slide.get('label','画面文字线索'))
            jobs.append((video,ppt_t,folder/f'{d["beat_id"]}-ppt.jpg'))
        rows.append(row)
    manifest[cid]={'title':data['intent_map']['title'],'poster':rows[0]['frame_url'] if rows else None,'beats':rows,'notes_url':f'./visuals/{cid}/notes.svg','map_url':f'./visuals/{cid}/mindmap.svg'}

def extract(job):
    video,t,destination=job
    if destination.exists():return
    args=[FFMPEG,'-hide_banner','-loglevel','error','-ss',str(t),'-i',str(video),'-frames:v','1','-vf','scale=960:-2','-q:v','3','-threads','1','-y',str(destination)]
    result=subprocess.run(args,capture_output=True)
    if result.returncode:raise RuntimeError(result.stderr.decode('utf-8',errors='replace')[-900:])
with ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(extract,jobs))

def lines(text,n):
    return textwrap.wrap(text,width=n,break_long_words=True,break_on_hyphens=False)
def text_svg(text,x,y,width=20,size=24,fill='#514463',gap=None,weight='normal',limit=6):
    rows=lines(text,width)[:limit];gap=gap or size*1.5
    return f'<text x="{x}" y="{y}" fill="{fill}" font-size="{size}" font-weight="{weight}">' + ''.join(f'<tspan x="{x}" dy="{0 if i==0 else gap}">{html.escape(row)}</tspan>' for i,row in enumerate(rows))+'</text>'
def image_data(path):return 'data:image/jpeg;base64,'+base64.b64encode(path.read_bytes()).decode()

colours=[('#f4effd','#aa8bce','#73518f'),('#eaf6f1','#72af99','#3f7b65'),('#fff5df','#d1b16d','#9b7a35'),('#fceef0','#cf98a5','#a36178')]
for cid,item in manifest.items():
    folder=OUT/cid
    notes=['<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="840" viewBox="0 0 1120 840"><defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#e8e3ed"/></pattern></defs><rect width="1120" height="840" rx="24" fill="#fffdf8"/><rect width="1120" height="840" rx="24" fill="url(#grid)"/><g font-family="KaiTi,STKaiti,serif">', '<text x="50" y="51" font-size="16" fill="#a99cb4" font-family="Segoe UI,sans-serif" letter-spacing="4">TALKEVAL++ / VISUAL NOTES</text>']
    notes.append(text_svg(item['title'],50,102,width=35,size=31,fill='#54415e',limit=1))
    notes.append('<path d="M50 116Q330 109 560 117" stroke="#e4d1a4" stroke-width="8" fill="none" opacity=".7"/><text x="50" y="149" font-size="18" fill="#a394ab">把重点记成画面，再循着时间回看。</text>')
    for i,row in enumerate(item['beats']):
        x=40+(i%2)*540;y=184+(i//2)*298
        bg,accent,ink=colours[i%4]
        thumb=image_data(folder/f'{row["beat_id"]}.jpg')
        notes.append(f'<g transform="translate({x},{y})"><rect x="3" y="6" width="510" height="276" rx="14" fill="#453251" opacity=".045"/><rect width="510" height="276" rx="14" fill="{bg}"/><path d="M174 -2L330 -2L326 15L178 12Z" fill="#fff8de" opacity=".85"/><rect x="24" y="29" width="202" height="114" rx="6" fill="white"/><image x="25" y="30" width="200" height="112" href="{thumb}" preserveAspectRatio="xMidYMid meet"/><text x="246" y="48" font-size="16" fill="{accent}" font-family="Segoe UI,sans-serif">NOTE {i+1:02d}</text>')
        notes.append(text_svg(row['note_title'],246,84,width=9,size=27,fill=ink,weight='bold',gap=36,limit=2))
        notes.append(f'<path d="M246 132Q349 126 471 134" fill="none" stroke="{accent}" stroke-width="6" opacity=".3"/>')
        notes.append(text_svg(row['note_summary'],25,178,width=22,size=20,fill='#77677f',gap=26,limit=3))
        m=int(row['time']//60);s=int(row['time']%60)
        notes.append(f'<text x="25" y="253" fill="{accent}" font-size="16">↳ {html.escape(row["keywords"])}</text><text x="454" y="253" text-anchor="end" fill="{ink}" font-size="15" font-family="Segoe UI,sans-serif">{m:02d}:{s:02d}</text></g>')
    notes.append('<text x="50" y="813" fill="#b2a3ba" font-size="16">整理自本案例已有观点与真实视频截图 · 完整语义及机器判定见证据卡</text></g></svg>')
    (folder/'notes.svg').write_text(''.join(notes),encoding='utf-8')
    diagram=['<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760"><rect width="1200" height="760" rx="24" fill="#fcfaff"/><g font-family="KaiTi,STKaiti,serif"><text x="42" y="46" font-family="Segoe UI,sans-serif" font-size="15" letter-spacing="4" fill="#b5a5c6">TALKEVAL++ / POINT MAP</text>']
    for i,row in enumerate(item['beats']):
        x=36 if i<2 else 794;y=83 if i%2==0 else 438
        bg,accent,ink=colours[i]
        edge=406 if i<2 else 794
        diagram.append(f'<path d="M600 380C{edge} 380,{edge} {y+100},{edge} {y+100}" stroke="{accent}" stroke-width="3" fill="none" opacity=".5"/><g transform="translate({x},{y})"><rect width="370" height="234" rx="16" fill="white" stroke="{accent}" stroke-width="1.5"/><rect x="15" y="16" width="92" height="24" rx="12" fill="{bg}"/><text x="61" y="33" fill="{ink}" font-size="13" text-anchor="middle" font-family="Segoe UI,sans-serif">POINT {i+1:02d}</text>')
        diagram.append(text_svg(row['note_title'],19,80,width=15,size=26,fill=ink,weight='bold',limit=1))
        diagram.append(text_svg(row['note_summary'],19,120,width=17,size=20,fill='#9582a4',gap=29,limit=3))
        diagram.append(f'<path d="M21 211Q170 207 346 211" stroke="{accent}" stroke-width="5" fill="none" opacity=".25"/></g>')
    diagram.append('<rect x="464" y="307" width="272" height="146" rx="28" fill="#ece3fa" stroke="#cab3e1"/><text x="600" y="335" text-anchor="middle" font-size="13" fill="#ad91c2" font-family="Segoe UI,sans-serif">SPEECH / 核心观点</text>')
    wrapped=lines(item['title'],9)[:3]
    for i,line in enumerate(wrapped):diagram.append(f'<text x="600" y="{368+i*29}" text-anchor="middle" font-size="24" fill="#816293">{html.escape(line)}</text>')
    diagram.append('<text x="600" y="734" text-anchor="middle" font-size="16" fill="#b9a5c9">四个观点，一眼看见表达结构 · 点击分支回看对应片段</text></g></svg>')
    (folder/'mindmap.svg').write_text(''.join(diagram),encoding='utf-8')
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
shutil.copytree(OUT,ROOT/'docs/visuals',dirs_exist_ok=True)
print(f'Created {len(jobs)} real video frames, {len(manifest)} visual notebooks and {len(manifest)} point maps.')
