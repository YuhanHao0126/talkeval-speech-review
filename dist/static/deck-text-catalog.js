// Text extracted from existing locally imported PPTX files.
export const deckTextCatalog={
  "/talkeval-speech-review/stage-decks/031829d8349306da71bae08ddb3a45b7/slide-001.png": {
    "title": "AI+软件创新  /  溢于言表队",
    "text": "AI+软件创新  /  溢于言表队\nTalkEval++\n面向表达意图的\n预测式演讲提示器\n预判动作走势 · 对齐表达目标 · 给出可执行指引\n观察\n预测\n指引\n调整\n限定场景原型 · 方法与交互预览\n01 / 08"
  },
  "/talkeval-speech-review/stage-decks/031829d8349306da71bae08ddb3a45b7/slide-002.png": {
    "title": "演讲中的三类表达难点",
    "text": "演讲中的三类表达难点\n重点是否讲全、动作是否贴切、提醒是否来得及，需要共同考虑\nTalkEval++ · 溢于言表\n02 / 08\n01\n说到了，含义却不完整\n流程讲完了，\n反馈如何进入下一轮仍未说明。\n需要核对必要含义\n02\n想讲循环，动作趋于停住\n手臂正在展开，\n动作走势未鲜明呈现循环关系。\n需要结合语义判断动作\n03\n提醒出现，调整时机已过\n讲后报告能帮助复盘，\n现场还需要简短、及时的指引。\n需要预判与介入时机\n因此，需要同时回答：此刻怎样调整，以及当前片段还缺什么"
  },
  "/talkeval-speech-review/stage-decks/031829d8349306da71bae08ddb3a45b7/slide-003.png": {
    "title": "现有工具与本轮切入点",
    "text": "现有工具与本轮切入点\n主流产品已覆盖表达反馈与排练；我们聚焦本人动作走势驱动的提前介入\nTalkEval++ · 溢于言表\n03 / 08\n工具 / 工作\n公开能力\n主要依据\nPowerPoint\nSpeaker Coach\n语速、音调、赘词与\n复述页面等反馈\n语音与演示表现\nYoodli\n情景排练、演讲练习、\n问答与反馈\n练习内容与情景目标\nGestureCoach\n相关研究 · UIST 2025\n按讲稿语义推荐手势，\n排练中提前展示示范\n讲稿语义与语音进度\n本轮探索：结合本人动作预测，决定是否提示、何时提示、怎样顺势调整\n资料：Microsoft、Yoodli 官方说明；GestureCoach 项目页（2026-11核对）"
  },
  "/talkeval-speech-review/stage-decks/031829d8349306da71bae08ddb3a45b7/slide-004.png": {
    "title": "快慢双通道架构",
    "text": "快慢双通道架构\n共用表达目标：快通道服务眼前调整，慢通道解释当前片段\nTalkEval++ · 溢于言表\n04 / 08\n已确认目标  ·  观点与必要含义  /  重要度  /  当前与后续计划页面\n快通道\n短时预测与指引\n实时监测\n未来预测\n效果评判\n未来建议\n形成指引\n用户调整后，重新观察\n慢通道\n片段量化与解释\n语音 · 动作 · PPT\n按观点与时间对齐\n量化结果与解释\n慢通道更新片段目标与缺口，为后续局部指引提供依据"
  },
  "/talkeval-speech-review/stage-decks/031829d8349306da71bae08ddb3a45b7/slide-005.png": {
    "title": "快通道 ①  预测动作的短时演化",
    "text": "快通道 ①  预测动作的短时演化\n世界模型的作用：提前看到动作可能怎样发展，为后续判断提供中间状态\nTalkEval++ · 溢于言表\n05 / 08\n局部动作世界模型\n关节位置、帧间变化与可见性 → 轻量GRU\n历史 2 秒\n40 帧观察\n未来 0.5 秒\n10 帧预测\nGRU\n输入：演讲者实际表现\n输出：未来动作走势，供语义匹配与时机选择\n当前实现：9个关键点、63维输入、两层GRU；图中动作为示意"
  },
  "/talkeval-speech-review/stage-decks/031829d8349306da71bae08ddb3a45b7/slide-006.png": {
    "title": "快通道 ②  将预测走势转为顺势指引",
    "text": "快通道 ②  将预测走势转为顺势指引\n以“反馈形成循环”为例，结合计划语义与页面关系选择参考动作\nTalkEval++ · 溢于言表\n06 / 08\n预测走势\n手臂展开后预计趋于端平\n效果评判\n可补充圆弧，增强循环关系的呈现\n形成建议\n从当前姿态顺势接上画圈参考\n演讲者小屏幕  /  参考动作\n顺势画圈，示意循环\n灰色：当前姿态  ·  绿色：参考轨迹\n若预测已沿圆弧运动、支持当前目标，则保持安静，不追加提醒\n方法与交互示意；参考动作来自示范模板，触发效果与有效提前量待实测"
  },
  "/talkeval-speech-review/stage-decks/031829d8349306da71bae08ddb3a45b7/slide-007.png": {
    "title": "慢通道：按观点与时间对齐，解释片段完成情况",
    "text": "慢通道：按观点与时间对齐，解释片段完成情况\n语言、动作和PPT共同支持哪个意思，以及它们何时对应\nTalkEval++ · 溢于言表\n07 / 08\n重要度加权覆盖率\nC(t) =\n∑ᵢ wᵢ cᵢ(t)\n∑ᵢ wᵢ\nwᵢ：观点重要度，讲前确认\ncᵢ(t)：截至时刻 t 的口头覆盖程度\n0 未覆盖  /  0.5 部分  /  1 完整\n示例观点：反馈进入下一轮，形成闭环\n语言\n“观察、分析、建议……”\n缺少反馈关系 · cᵢ(t)\n动作\n腕部圆弧 / 回指起点\n支持循环语义 · aᵢ(t)\nPPT\n“调整 → 观察”的回路\n页面关系一致 · pᵢ(t)\n同一语义时间窗口\nt − Δ\n当前片段 t\n只讲“观察—分析—建议” → 口头覆盖为部分\n即使动作与页面支持，也应补充“调整结果进入下一轮”\n0.5\n1\n1\n右侧为机制示例评分，非实测结果"
  },
  "/talkeval-speech-review/stage-decks/031829d8349306da71bae08ddb3a45b7/slide-008.png": {
    "title": "本轮亮点与下一步",
    "text": "本轮亮点与下一步\n以有限动作和有限场景验证机制，再逐步扩大适用范围\nTalkEval++ · 溢于言表\n08 / 08\n01\n走势驱动介入\n本人动作预测参与是否提示、何时提示和顺势调整\n02\n快慢协同\n短时可执行指引，与片段目标核对相互衔接\n03\n证据可解释\n观点、原句、动作和页面回到同一时间证据\n当前边界\n演讲视频小样本监督训练\n仅覆盖少量手臂与腕部动作\n语义指引与三模态联动在开发\n有效提前量与用户收益待验证\n下一步扩展\n更多动作与表达语义\n更多演讲者、视角与真实排练\n实时摄像头与便携显示终端\n让表达目标被说清、被看见，也让每条提示有依据"
  },
  "/talkeval-speech-review/stage-decks/179c47b4070173e6852d64f670d272ac/slide-001.png": {
    "title": "AI+软件创新  /  溢于言表队",
    "text": "AI+软件创新  /  溢于言表队\nTalkEval++\n面向表达意图的\n预测式演讲提示器\n预判动作走势 · 对齐表达目标 · 给出可执行指引\n观察\n预测\n指引\n调整\n限定场景原型 · 方法与交互预览\n01 / 08"
  },
  "/talkeval-speech-review/stage-decks/179c47b4070173e6852d64f670d272ac/slide-002.png": {
    "title": "演讲中的三类表达难点",
    "text": "演讲中的三类表达难点\n重点是否讲全、动作是否贴切、提醒是否来得及，需要共同考虑\nTalkEval++ · 溢于言表\n02 / 08\n01\n说到了，含义却不完整\n流程讲完了，\n反馈如何进入下一轮仍未说明。\n需要核对必要含义\n02\n想讲循环，动作趋于停住\n手臂正在展开，\n动作走势未鲜明呈现循环关系。\n需要结合语义判断动作\n03\n提醒出现，调整时机已过\n讲后报告能帮助复盘，\n现场还需要简短、及时的指引。\n需要预判与介入时机\n因此，需要同时回答：此刻怎样调整，以及当前片段还缺什么"
  },
  "/talkeval-speech-review/stage-decks/179c47b4070173e6852d64f670d272ac/slide-003.png": {
    "title": "现有工具与本轮切入点",
    "text": "现有工具与本轮切入点\n主流产品已覆盖表达反馈与排练；我们聚焦本人动作走势驱动的提前介入\nTalkEval++ · 溢于言表\n03 / 08\n工具 / 工作\n公开能力\n主要依据\nPowerPoint\nSpeaker Coach\n语速、音调、赘词与\n复述页面等反馈\n语音与演示表现\nYoodli\n情景排练、演讲练习、\n问答与反馈\n练习内容与情景目标\nGestureCoach\n相关研究 · UIST 2025\n按讲稿语义推荐手势，\n排练中提前展示示范\n讲稿语义与语音进度\n本轮探索：结合本人动作预测，决定是否提示、何时提示、怎样顺势调整\n资料：Microsoft、Yoodli 官方说明；GestureCoach 项目页（2026-11核对）"
  },
  "/talkeval-speech-review/stage-decks/179c47b4070173e6852d64f670d272ac/slide-004.png": {
    "title": "快慢双通道架构",
    "text": "快慢双通道架构\n共用表达目标：快通道服务眼前调整，慢通道解释当前片段\nTalkEval++ · 溢于言表\n04 / 08\n已确认目标  ·  观点与必要含义  /  重要度  /  当前与后续计划页面\n快通道\n短时预测与指引\n实时监测\n未来预测\n效果评判\n未来建议\n形成指引\n用户调整后，重新观察\n慢通道\n片段量化与解释\n语音 · 动作 · PPT\n按观点与时间对齐\n量化结果与解释\n慢通道更新片段目标与缺口，为后续局部指引提供依据"
  },
  "/talkeval-speech-review/stage-decks/179c47b4070173e6852d64f670d272ac/slide-005.png": {
    "title": "快通道 ①  预测动作的短时演化",
    "text": "快通道 ①  预测动作的短时演化\n世界模型的作用：提前看到动作可能怎样发展，为后续判断提供中间状态\nTalkEval++ · 溢于言表\n05 / 08\n局部动作世界模型\n关节位置、帧间变化与可见性 → 轻量GRU\n历史 2 秒\n40 帧观察\n未来 0.5 秒\n10 帧预测\nGRU\n输入：演讲者实际表现\n输出：未来动作走势，供语义匹配与时机选择\n当前实现：9个关键点、63维输入、两层GRU；图中动作为示意"
  },
  "/talkeval-speech-review/stage-decks/179c47b4070173e6852d64f670d272ac/slide-006.png": {
    "title": "快通道 ②  将预测走势转为顺势指引",
    "text": "快通道 ②  将预测走势转为顺势指引\n以“反馈形成循环”为例，结合计划语义与页面关系选择参考动作\nTalkEval++ · 溢于言表\n06 / 08\n预测走势\n手臂展开后预计趋于端平\n效果评判\n可补充圆弧，增强循环关系的呈现\n形成建议\n从当前姿态顺势接上画圈参考\n演讲者小屏幕  /  参考动作\n顺势画圈，示意循环\n灰色：当前姿态  ·  绿色：参考轨迹\n若预测已沿圆弧运动、支持当前目标，则保持安静，不追加提醒\n方法与交互示意；参考动作来自示范模板，触发效果与有效提前量待实测"
  },
  "/talkeval-speech-review/stage-decks/179c47b4070173e6852d64f670d272ac/slide-007.png": {
    "title": "慢通道：按观点与时间对齐，解释片段完成情况",
    "text": "慢通道：按观点与时间对齐，解释片段完成情况\n语言、动作和PPT共同支持哪个意思，以及它们何时对应\nTalkEval++ · 溢于言表\n07 / 08\n重要度加权覆盖率\nC(t) =\n∑ᵢ wᵢ cᵢ(t)\n∑ᵢ wᵢ\nwᵢ：观点重要度，讲前确认\ncᵢ(t)：截至时刻 t 的口头覆盖程度\n0 未覆盖  /  0.5 部分  /  1 完整\n示例观点：反馈进入下一轮，形成闭环\n语言\n“观察、分析、建议……”\n缺少反馈关系 · cᵢ(t)\n动作\n腕部圆弧 / 回指起点\n支持循环语义 · aᵢ(t)\nPPT\n“调整 → 观察”的回路\n页面关系一致 · pᵢ(t)\n同一语义时间窗口\nt − Δ\n当前片段 t\n只讲“观察—分析—建议” → 口头覆盖为部分\n即使动作与页面支持，也应补充“调整结果进入下一轮”\n0.5\n1\n1\n右侧为机制示例评分，非实测结果"
  },
  "/talkeval-speech-review/stage-decks/179c47b4070173e6852d64f670d272ac/slide-008.png": {
    "title": "本轮亮点与下一步",
    "text": "本轮亮点与下一步\n以有限动作和有限场景验证机制，再逐步扩大适用范围\nTalkEval++ · 溢于言表\n08 / 08\n01\n走势驱动介入\n本人动作预测参与是否提示、何时提示和顺势调整\n02\n快慢协同\n短时可执行指引，与片段目标核对相互衔接\n03\n证据可解释\n观点、原句、动作和页面回到同一时间证据\n当前边界\n演讲视频小样本监督训练\n仅覆盖少量手臂与腕部动作\n语义指引与三模态联动在开发\n有效提前量与用户收益待验证\n下一步扩展\n更多动作与表达语义\n更多演讲者、视角与真实排练\n实时摄像头与便携显示终端\n让表达目标被说清、被看见，也让每条提示有依据"
  },
  "/talkeval-speech-review/stage-decks/3516eb470d022f098bf4570eb90241ed/slide-001.png": {
    "title": "人生，像一场",
    "text": "人生，像一场\n泊松过程\nN(t) ∼ Poisson(λt)\n等待与阶跃，构成向上的轨迹\nN(t)\nt"
  },
  "/talkeval-speech-review/stage-decks/3516eb470d022f098bf4570eb90241ed/slide-002.png": {
    "title": "大多数时间，是等待",
    "text": "大多数时间，是等待\n漫长、平稳的准备，藏在曲线的水平处\n准备与等待\nΔT\nN(t)\nt\n泊松过程样本路径示意"
  },
  "/talkeval-speech-review/stage-decks/3516eb470d022f098bf4570eb90241ed/slide-003.png": {
    "title": "平稳处",
    "text": "平稳处\n正在蓄力\n在独处中打磨自己\n在坚持中完善自我"
  },
  "/talkeval-speech-review/stage-decks/3516eb470d022f098bf4570eb90241ed/slide-004.png": {
    "title": "机遇到来",
    "text": "机遇到来\n果断出击\nt = t₀\n把准备，变成行动"
  },
  "/talkeval-speech-review/stage-decks/3516eb470d022f098bf4570eb90241ed/slide-005.png": {
    "title": "抓住机会，完成阶跃",
    "text": "抓住机会，完成阶跃\nN(t) = n + H(t − t₀)\n准备与蓄力\n全新阶段\nn\nn + 1\nt₀\n抓住机会的时刻\nt\n单次阶跃的局部示意"
  },
  "/talkeval-speech-review/stage-decks/b2d5df9095770c6070bbaef3416009d7/slide-001.png": {
    "title": "人生，像一场",
    "text": "人生，像一场\n泊松过程\nN(t) ∼ Poisson(λt)\n等待与阶跃，构成向上的轨迹\nN(t)\nt"
  },
  "/talkeval-speech-review/stage-decks/b2d5df9095770c6070bbaef3416009d7/slide-002.png": {
    "title": "大多数时间，是等待",
    "text": "大多数时间，是等待\n漫长、平稳的准备，藏在曲线的水平处\n准备与等待\nΔT\nN(t)\nt\n泊松过程样本路径示意"
  },
  "/talkeval-speech-review/stage-decks/b2d5df9095770c6070bbaef3416009d7/slide-003.png": {
    "title": "平稳处",
    "text": "平稳处\n正在蓄力\n在独处中打磨自己\n在坚持中完善自我"
  },
  "/talkeval-speech-review/stage-decks/b2d5df9095770c6070bbaef3416009d7/slide-004.png": {
    "title": "机遇到来",
    "text": "机遇到来\n果断出击\nt = t₀\n把准备，变成行动"
  },
  "/talkeval-speech-review/stage-decks/b2d5df9095770c6070bbaef3416009d7/slide-005.png": {
    "title": "抓住机会，完成阶跃",
    "text": "抓住机会，完成阶跃\nN(t) = n + H(t − t₀)\n准备与蓄力\n全新阶段\nn\nn + 1\nt₀\n抓住机会的时刻\nt\n单次阶跃的局部示意"
  },
  "/talkeval-speech-review/stage-decks/c98bfcaade598d6ee0426809fa08d981/slide-001.png": {
    "title": "人生，像一场",
    "text": "人生，像一场\n泊松过程\nN(t) ∼ Poisson(λt)\n等待与阶跃，构成向上的轨迹\nN(t)\nt"
  },
  "/talkeval-speech-review/stage-decks/c98bfcaade598d6ee0426809fa08d981/slide-002.png": {
    "title": "大多数时间，是等待",
    "text": "大多数时间，是等待\n漫长、平稳的准备，藏在曲线的水平处\n准备与等待\nΔT\nN(t)\nt\n泊松过程样本路径示意"
  },
  "/talkeval-speech-review/stage-decks/c98bfcaade598d6ee0426809fa08d981/slide-003.png": {
    "title": "平稳处",
    "text": "平稳处\n正在蓄力\n在独处中打磨自己\n在坚持中完善自我"
  },
  "/talkeval-speech-review/stage-decks/c98bfcaade598d6ee0426809fa08d981/slide-004.png": {
    "title": "机遇到来",
    "text": "机遇到来\n果断出击\nt = t₀\n把准备，变成行动"
  },
  "/talkeval-speech-review/stage-decks/c98bfcaade598d6ee0426809fa08d981/slide-005.png": {
    "title": "抓住机会，完成阶跃",
    "text": "抓住机会，完成阶跃\nN(t) = n + H(t − t₀)\n准备与蓄力\n全新阶段\nn\nn + 1\nt₀\n抓住机会的时刻\nt\n单次阶跃的局部示意"
  },
  "/talkeval-speech-review/stage-decks/dde78dd8eabc5efdd720d97c25ef7fc1/slide-001.png": {
    "title": "AI+软件创新  /  溢于言表队",
    "text": "AI+软件创新  /  溢于言表队\nTalkEval++\n面向表达意图的\n预测式演讲提示器\n预判动作走势 · 对齐表达目标 · 给出可执行指引\n观察\n预测\n指引\n调整\n限定场景原型 · 方法与交互预览\n01 / 08"
  },
  "/talkeval-speech-review/stage-decks/dde78dd8eabc5efdd720d97c25ef7fc1/slide-002.png": {
    "title": "演讲中的三类表达难点",
    "text": "演讲中的三类表达难点\n重点是否讲全、动作是否贴切、提醒是否来得及，需要共同考虑\nTalkEval++ · 溢于言表\n02 / 08\n01\n说到了，含义却不完整\n流程讲完了，\n反馈如何进入下一轮仍未说明。\n需要核对必要含义\n02\n想讲循环，动作趋于停住\n手臂正在展开，\n动作走势未鲜明呈现循环关系。\n需要结合语义判断动作\n03\n提醒出现，调整时机已过\n讲后报告能帮助复盘，\n现场还需要简短、及时的指引。\n需要预判与介入时机\n因此，需要同时回答：此刻怎样调整，以及当前片段还缺什么"
  },
  "/talkeval-speech-review/stage-decks/dde78dd8eabc5efdd720d97c25ef7fc1/slide-003.png": {
    "title": "现有工具与本轮切入点",
    "text": "现有工具与本轮切入点\n主流产品已覆盖表达反馈与排练；我们聚焦本人动作走势驱动的提前介入\nTalkEval++ · 溢于言表\n03 / 08\n工具 / 工作\n公开能力\n主要依据\nPowerPoint\nSpeaker Coach\n语速、音调、赘词与\n复述页面等反馈\n语音与演示表现\nYoodli\n情景排练、演讲练习、\n问答与反馈\n练习内容与情景目标\nGestureCoach\n相关研究 · UIST 2025\n按讲稿语义推荐手势，\n排练中提前展示示范\n讲稿语义与语音进度\n本轮探索：结合本人动作预测，决定是否提示、何时提示、怎样顺势调整\n资料：Microsoft、Yoodli 官方说明；GestureCoach 项目页（2026-11核对）"
  },
  "/talkeval-speech-review/stage-decks/dde78dd8eabc5efdd720d97c25ef7fc1/slide-004.png": {
    "title": "快慢双通道架构",
    "text": "快慢双通道架构\n共用表达目标：快通道服务眼前调整，慢通道解释当前片段\nTalkEval++ · 溢于言表\n04 / 08\n已确认目标  ·  观点与必要含义  /  重要度  /  当前与后续计划页面\n快通道\n短时预测与指引\n实时监测\n未来预测\n效果评判\n未来建议\n形成指引\n用户调整后，重新观察\n慢通道\n片段量化与解释\n语音 · 动作 · PPT\n按观点与时间对齐\n量化结果与解释\n慢通道更新片段目标与缺口，为后续局部指引提供依据"
  },
  "/talkeval-speech-review/stage-decks/dde78dd8eabc5efdd720d97c25ef7fc1/slide-005.png": {
    "title": "快通道 ①  预测动作的短时演化",
    "text": "快通道 ①  预测动作的短时演化\n世界模型的作用：提前看到动作可能怎样发展，为后续判断提供中间状态\nTalkEval++ · 溢于言表\n05 / 08\n局部动作世界模型\n关节位置、帧间变化与可见性 → 轻量GRU\n历史 2 秒\n40 帧观察\n未来 0.5 秒\n10 帧预测\nGRU\n输入：演讲者实际表现\n输出：未来动作走势，供语义匹配与时机选择\n当前实现：9个关键点、63维输入、两层GRU；图中动作为示意"
  },
  "/talkeval-speech-review/stage-decks/dde78dd8eabc5efdd720d97c25ef7fc1/slide-006.png": {
    "title": "快通道 ②  将预测走势转为顺势指引",
    "text": "快通道 ②  将预测走势转为顺势指引\n以“反馈形成循环”为例，结合计划语义与页面关系选择参考动作\nTalkEval++ · 溢于言表\n06 / 08\n预测走势\n手臂展开后预计趋于端平\n效果评判\n可补充圆弧，增强循环关系的呈现\n形成建议\n从当前姿态顺势接上画圈参考\n演讲者小屏幕  /  参考动作\n顺势画圈，示意循环\n灰色：当前姿态  ·  绿色：参考轨迹\n若预测已沿圆弧运动、支持当前目标，则保持安静，不追加提醒\n方法与交互示意；参考动作来自示范模板，触发效果与有效提前量待实测"
  },
  "/talkeval-speech-review/stage-decks/dde78dd8eabc5efdd720d97c25ef7fc1/slide-007.png": {
    "title": "慢通道：按观点与时间对齐，解释片段完成情况",
    "text": "慢通道：按观点与时间对齐，解释片段完成情况\n语言、动作和PPT共同支持哪个意思，以及它们何时对应\nTalkEval++ · 溢于言表\n07 / 08\n重要度加权覆盖率\nC(t) =\n∑ᵢ wᵢ cᵢ(t)\n∑ᵢ wᵢ\nwᵢ：观点重要度，讲前确认\ncᵢ(t)：截至时刻 t 的口头覆盖程度\n0 未覆盖  /  0.5 部分  /  1 完整\n示例观点：反馈进入下一轮，形成闭环\n语言\n“观察、分析、建议……”\n缺少反馈关系 · cᵢ(t)\n动作\n腕部圆弧 / 回指起点\n支持循环语义 · aᵢ(t)\nPPT\n“调整 → 观察”的回路\n页面关系一致 · pᵢ(t)\n同一语义时间窗口\nt − Δ\n当前片段 t\n只讲“观察—分析—建议” → 口头覆盖为部分\n即使动作与页面支持，也应补充“调整结果进入下一轮”\n0.5\n1\n1\n右侧为机制示例评分，非实测结果"
  },
  "/talkeval-speech-review/stage-decks/dde78dd8eabc5efdd720d97c25ef7fc1/slide-008.png": {
    "title": "本轮亮点与下一步",
    "text": "本轮亮点与下一步\n以有限动作和有限场景验证机制，再逐步扩大适用范围\nTalkEval++ · 溢于言表\n08 / 08\n01\n走势驱动介入\n本人动作预测参与是否提示、何时提示和顺势调整\n02\n快慢协同\n短时可执行指引，与片段目标核对相互衔接\n03\n证据可解释\n观点、原句、动作和页面回到同一时间证据\n当前边界\n演讲视频小样本监督训练\n仅覆盖少量手臂与腕部动作\n语义指引与三模态联动在开发\n有效提前量与用户收益待验证\n下一步扩展\n更多动作与表达语义\n更多演讲者、视角与真实排练\n实时摄像头与便携显示终端\n让表达目标被说清、被看见，也让每条提示有依据"
  }
};
