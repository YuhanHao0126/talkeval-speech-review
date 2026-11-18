# 展示人物资源

人物来自 Microsoft Rocketbox Avatar Library 的 Female_Adult_08 和 Male_Adult_01。

- 原仓库：https://github.com/microsoft/Microsoft-Rocketbox
- 原文件：https://github.com/microsoft/Microsoft-Rocketbox/tree/master/Assets/Avatars/Adults/Female_Adult_08
- 男性人物：https://github.com/microsoft/Microsoft-Rocketbox/tree/master/Assets/Avatars/Adults/Male_Adult_01
- 许可：MIT，完整声明保存在本目录 `LICENSE.txt`。
- 本地处理：将FBX转换为GLB并保留骨骼与蒙皮；`speaker.glb` 使用1024像素贴图，`speaker-hd.glb` 使用2048像素贴图。页面按皮肤、衣服、头发分别设置物理材质。源网格的几何细节不因提升贴图分辨率而增加。
- 重建流程：先运行 `tools/prepare_avatar_assets.py`，启动本机服务，再运行 `tools/build_avatar.py`。重建脚本另需 Pillow、Playwright 和本机Chrome。
- 男性人物重建时，为两个命令都加 `--character male`，生成 `speaker-male.glb` 与 `speaker-male-hd.glb`。

页面支持男性、女性两种角色外观，预测网络与数据相同。自动选择依次使用演讲资料中的 `avatar_preference`、该视频已保存的角色、上次选择的角色；缺少偏好时显示默认男性人物并明确标注。手动选择优先。偏好仅保存在本机浏览器。这里保存的是用户想使用的角色，不读取人脸、声音或姓名来推断性别，也不将人物选项作为训练标签。

这是通用展示人物，不是对视频里演讲者外貌的重建。预测仅提供9个关键点，手指、表情、下半身没有预测；手腕可见而手肘不可见时，使用固定臂长的双骨骼几何解算完成显示。未观测到的整条手臂用自然垂放姿态占位，并在页面标注，不作为评测数据或导出预测。
