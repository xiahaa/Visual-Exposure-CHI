我重新检查了当前 main 分支。结论：**这次修改很明显，已经基本修复了上一轮最关键的几个问题，可以进入 internal pilot；但还不建议马上进入正式 controlled study。** 我这里是静态审查，没有本地运行，因为当前环境无法直接 clone GitHub。

总体上，仓库已经更贴近你们原始 Topic 2 的目标：飞行前展示隐私视场、允许公众标注“不拍摄/高敏感区域”，并反馈这些偏好对航线、覆盖和任务效果的影响。

## 已经显著改进的地方

第一，**术语修正到位**。前端已经把原来的 `Optimize for Privacy` 改成了 `Generate Privacy Options`，把 `Compare With Preferences` 改成了 `Show Preference-Weighted Exposure`。这非常重要，因为现在不会把候选方案生成误写成全局最优规划，也不会把“偏好加权”误写成真实隐私缓解。App 里已经没有 `Optimize for Privacy` 文案，并显示 `Generate Privacy Options`。([GitHub][1])

第二，**API 文档已经同步**。`docs/API.md` 现在明确说明 `/api/exposure/compare` 只是 preference-weighted exposure comparison，不生成新航线，也不声称 mitigation；同时新增 `/api/planning/optimize`，并明确它是 deterministic candidate-based response generator，不是 globally optimal path planner。([GitHub][2]) 这对 CHI 论文写作很关键，可以避免审稿人把你们当作路径规划算法论文来审。

第三，**Demo script 也同步了完整实验流程**。现在 demo 明确区分 C1/C2/C3，并说明 C1 是 notice only，C2 是 route + footprint/frustum，C3 才包含 exposure、preference 和 planning workflow。它也说明 `Show Preference-Weighted Exposure` 只改变关注权重，不生成新航线，而 `Generate Privacy Options` 才生成隐私感知替代方案。([GitHub][3])

第四，**route response 逻辑有实质进步**。`planning.py` 现在加入了 route densification：先用 `densify_route(..., step_m=20.0)` 对长航段插入中间点，再对 densified route 做偏好区域响应。这样比上一版只移动原始 waypoint 好很多，因为长航段经过敏感区域但端点较远的问题被缓解了。([GitHub][4])

第五，**偏好目标从 centroid 升级为 polygon geometry**。现在 `PreferenceTarget` 存的是 ENU 坐标下的 Shapely geometry，而不是只存 centroid；`_nearest_target()` 使用 route point 到 polygon geometry 的距离，并用 `nearest_points()` 找最近点。这是比 centroid-based response 更合理的实现。([GitHub][4])

第六，**logging 已经补上**。新增 `studyLogger.ts`，支持生成带 timestamp、event、scenario、condition、route、camera、option、summary 等字段的 log event，并能导出 JSONL。App 里也已经有 `Download Study Log`，并记录 condition switch、manual waypoint、surface inspect、preference polygon close、planning preview、planning apply 等事件。([GitHub][5]) Demo 也已经把下载日志纳入流程。([GitHub][3])

第七，**实验条件隔离明显更强**。前端测试现在明确检查：C1 隐藏 `Compute Exposure`、`Show Preference-Weighted Exposure`、`Generate Privacy Options`、route upload 和高级相机参数；C2 保留 route/footprint，但隐藏 exposure、preference 和 planning 控件。([GitHub][6]) 这已经接近正式 controlled study 的条件隔离要求。

## 还需要修的几个点

**1. `depth_limited_camera` 的 explanation 还没完全同步。**
候选策略已经从 `gimbal_away` 改成了 `depth_limited_camera`，这很好；但 `_candidate_explanation()` 里仍然只有 `altitude`、`lateral`、`gimbal`、`combined` 四类解释，没有 `depth_limited_camera`。因此 depth-limited 候选可能会落到默认解释，造成 UI explanation 不准确。建议加入：

```python
"depth_limited_camera": (
    "Limits the effective visual depth and adjusts the camera pitch near marked "
    "privacy areas to reduce long-range recognizable exposure."
)
```

相关代码在 planning candidate specs 和 explanation mapping 这一段。([GitHub][4])

**2. route point 落在 polygon 内部时，lateral offset 可能失效。**
当前 `_nearest_target()` 使用 `nearest_points(route_point, target.geometry)[1]`，如果 route point 在 polygon 内部，最近点可能就是点本身或几何内部点。随后 `dx = enu.x - nearest.x`、`dy = enu.y - nearest.y` 可能接近 0，虽然 altitude raise 仍然有效，但 lateral detour 方向会退化。([GitHub][4])

建议加一个 fallback：当 route point 在 polygon 内部或 `sqrt(dx^2+dy^2)` 很小时，用 polygon centroid 的反方向，或者用 nearest point on exterior ring：

```python
if target.geometry.contains(route_point):
    boundary_point = nearest_points(route_point, target.geometry.exterior)[1]
    dx = route_point.x - boundary_point.x
    dy = route_point.y - boundary_point.y
    if hypot(dx, dy) < eps:
        centroid = target.geometry.centroid
        dx = route_point.x - centroid.x
        dy = route_point.y - centroid.y
```

这个问题会影响“从敏感区内绕出”的视觉效果，建议优先修。

**3. backend validation 还没有真正补齐。**
前端测试已经比较完整，但我没有看到 `backend/tests` 目录；GitHub backend 目录中只有 `app`、`config`、`README.md` 和 `requirements.txt`。([GitHub][7]) 但 backend README 仍然写着 `python -m unittest discover -s tests`。([GitHub][8]) 这说明后端测试文档和代码还不一致。

建议至少加入五个后端测试：

```text
test_densify_route_inserts_points_on_long_segment
test_preference_polygon_inside_point_gets_nonzero_repulsion_direction
test_depth_limited_camera_candidate_reduces_max_depth
test_planning_endpoint_returns_candidate_options
test_exposure_wall_occlusion_or_simple_plane_first_hit
```

其中前两个直接针对这次 planner 逻辑，后两个用于支撑 CHI paper 的技术可信度。

**4. C2 允许 route upload/manual route，正式实验时要小心。**
测试里显示 C2 仍允许 `Route file` 和 `New Manual Route`，但不允许 compute exposure、preference 和 planning。([GitHub][6]) 如果 C2 的任务是让参与者理解固定航线，这没问题；但如果你希望 C2 和 C3 都基于同一条 route 进行条件比较，正式实验版本最好把 route editing 作为 researcher/facilitator control，而不是 participant control。否则不同条件下用户可能因修改 route 而引入额外变量。

**5. 代码格式仍然像被压成了长行。**
raw 文件显示很多 TS/Python 文件仍然是超长单行或极少行，例如 `main.py`、`api.ts`、`studyLogger.ts`、`planning.py`。这可能只是生成工具造成的换行问题，也可能是 repo 真实格式。无论哪种，正式 artifact 前建议用 `black`、`ruff`、`prettier`、`eslint` 统一格式。否则后续协作和 artifact review 会比较吃亏。([GitHub][9])

## 是否可以进入 pilot？

可以。现在我建议进入 **internal pilot / formative pilot**，目标不是检验显著性，而是检查界面理解和实验流程：

```text
用户是否理解 footprint、exposure、preference-weighted exposure、privacy options 之间的区别；
用户是否知道 Show Preference-Weighted Exposure 不等于系统已经修改航线；
用户是否能理解 suggested alternatives 的 exposure reduction / route length / coverage loss；
用户是否会误以为 Generate Privacy Options 是全局最优解；
用户是否能顺利导出 study log。
```

正式 controlled study 前，我建议先完成三个修补：补 `depth_limited_camera` explanation，修 polygon 内部 repulsion fallback，补 backend validation tests。完成后，这个工具就基本可以支撑 CHI 论文的 prototype + controlled study。

[1]: https://raw.githubusercontent.com/xiahaa/Visual-Exposure-CHI/main/frontend/src/App.tsx "raw.githubusercontent.com"
[2]: https://raw.githubusercontent.com/xiahaa/Visual-Exposure-CHI/main/docs/API.md "raw.githubusercontent.com"
[3]: https://raw.githubusercontent.com/xiahaa/Visual-Exposure-CHI/main/docs/DEMO_SCRIPT.md "raw.githubusercontent.com"
[4]: https://raw.githubusercontent.com/xiahaa/Visual-Exposure-CHI/main/backend/app/services/planning.py?cachebust=20260527 "raw.githubusercontent.com"
[5]: https://raw.githubusercontent.com/xiahaa/Visual-Exposure-CHI/main/frontend/src/studyLogger.ts "raw.githubusercontent.com"
[6]: https://raw.githubusercontent.com/xiahaa/Visual-Exposure-CHI/main/frontend/src/App.test.tsx?cachebust=20260527 "raw.githubusercontent.com"
[7]: https://github.com/xiahaa/Visual-Exposure-CHI/tree/main/backend "Visual-Exposure-CHI/backend at main · xiahaa/Visual-Exposure-CHI · GitHub"
[8]: https://raw.githubusercontent.com/xiahaa/Visual-Exposure-CHI/main/backend/README.md?cachebust=20260527 "raw.githubusercontent.com"
[9]: https://raw.githubusercontent.com/xiahaa/Visual-Exposure-CHI/main/backend/app/main.py "raw.githubusercontent.com"
