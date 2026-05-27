我重新做了一轮静态代码审查。结论是：**这次改进是实质性的，已经从“visual exposure inspection tool”推进到了“privacy-aware response generation prototype”。** 现在最重要的短板不再是技术路线，而是实验条件隔离、术语表述、logging、backend validation 和文档同步。

我没有在本地运行仓库；我这里基于 GitHub 当前公开源码与文档做静态审查。

---

## 1. 主要进步

最大的进步是你已经补上了我上次指出的核心缺口：**用户偏好不再只是提高 sensitivity，而是可以触发 route/camera adaptation。** 现在后端已经有 `/api/planning/optimize`，并引入 `PlanningRequest`、`PlannerConfig` 和 `optimize_planning()`；规划模块会生成 altitude、lateral detour、gimbal、combined 等确定性候选方案，并用 Open3D exposure summary 进行排序。([GitHub][1])

这非常关键，因为原始 Topic 2 的目标并不是单纯画热力图，而是让用户标注“不拍摄区域”“高敏感区域”之后，系统能够反馈这些偏好对路径、覆盖范围和任务效果的影响。 现在这个闭环已经有了雏形。

前端也同步补上了 `optimizePlanning()` API、`PlanningResponse` schema、`PlanningOptionsPanel`、`Optimize for Privacy`、`Preview` 和 `Apply` 逻辑。([GitHub][2]) 这使 C3 条件真正具备了“preference articulation → system response → trade-off preview”的研究价值。

还有一个明显进步是测试。现在前端测试覆盖了场景加载、C1/C2/C3 切换、上传 GeoJSON 路线、相机 preset、高级相机参数、手动航线、偏好 polygon、compare request，以及 privacy optimization workflow。([GitHub][3]) 这对 CHI artifact 和后续用户实验稳定性很有帮助。

---

## 2. 当前版本已经可以支撑什么

现在可以支撑一套比较完整的 **internal pilot study**：

用户看到基础航线通知；

切换 C2 后看到 route + camera footprint；

切换 C3 后计算 estimated visual exposure；

用户标注 sensitive / do-not-capture polygon；

系统生成 privacy-first / balanced / task-preserving 这类 route-camera alternatives；

用户 preview 或 apply 方案；

系统展示 sensitive exposure reduction、route length increase、coverage loss 和 objective terms。

这已经非常接近 CHI paper 里需要的 research prototype。README 中对项目的定义也仍然是正确的：这是一个帮助非专业公众查看 planned drone routes、理解 estimated visual exposure、表达 spatial privacy preferences、比较 privacy-task trade-offs 的 CHI research prototype，而不是完整低空交通平台。([GitHub][4])

---

## 3. 仍然需要修的核心问题

### 3.1 `Compare With Preferences` 和 `Optimize for Privacy` 需要概念上分开

目前 `Compare With Preferences` 仍然调用 `/api/exposure/compare`，其 before 和 after 的主要区别是 after 带了 user_preferences。后端 `_apply_user_preferences()` 仍然只是把用户标注区域的 sensitivity 提高，几何航线和相机行为没有改变。源码注释也明确写了：preferences do not delete surfaces or perform path planning，而只是改变 visible hits 的权重。([GitHub][5])

所以这个按钮不应该被解释为“系统响应后隐私暴露降低”。它更准确的含义是：

> 用户标注后，系统如何重新加权并凸显 concern-weighted exposure。

建议把按钮和文案改成：

**Current:** Compare With Preferences
**Better:** Reweight by Preferences / Show Preference-Weighted Exposure
**中文:** 按隐私偏好重新加权 / 查看偏好加权暴露

真正的 privacy-task trade-off 应该只放在 **Optimize for Privacy** 之后，因为 planning 模块才会改变 route、altitude、yaw、gimbal pitch 和 max depth。

---

### 3.2 `Optimize for Privacy` 建议改名，避免“最优规划”风险

当前 planner 是 deterministic candidate generator，不是严格意义上的最优路径规划器。它会生成有限候选：altitude raise、lateral offset、gimbal/depth adjustment、combined strategy，然后通过 objective 排序。([GitHub][6]) 这对 CHI 原型完全足够，但论文和 UI 里不宜称为 optimization。

建议 UI 改成：

**Generate Privacy Options**
或者
**Suggest Privacy-Aware Alternatives**

中文可以写：

**生成隐私响应方案**
而不是
**隐私优化**

论文方法中也建议写：

> We use a deterministic candidate-based response generator rather than an optimal path planner.

这样审稿人不会追问 planner optimality、completeness 或 convergence。

---

### 3.3 当前 detour 只移动 waypoint，可能漏掉穿越敏感区的航段

`_adjust_route()` 对每个 waypoint 找最近 privacy target，并根据距离 falloff 调整该 waypoint 的 lateral offset、altitude 和 yaw。([GitHub][6]) 这个实现简单清楚，但有一个几何问题：如果一条长航段穿过 sensitive polygon 附近，而两个端点都离 polygon 较远，则 waypoint-based adjustment 可能完全不会生效。

建议下一步把 route 先 densify：

```text
original waypoints
→ segment sampling every 10–20 m
→ apply privacy response field
→ simplify route if needed
```

这样 lateral detour 才真正作用于航段，而不只是作用于航点。

---

### 3.4 preference target 不应只用 polygon centroid

现在 `_preference_targets()` 把用户画的 polygon 转成 centroid，再作为 target。([GitHub][6]) 对小 polygon 可以，但对长条形、L 形、凹多边形、沿街区域或一组窗口区域会偏差明显。

建议把 target model 升级为：

```text
polygon distance field
segment-to-polygon distance
polygon buffer
nearest point on polygon boundary
```

MVP 可以先做一个简单版本：对每个 sampled route point，计算它到每个 preference polygon 的 Shapely distance，而不是到 centroid 的距离。

---

### 3.5 gimbal response 的语义需要更严谨

当前 `gimbal_away` 实际做的是让 pitch 更向下，并缩短 max_depth。([GitHub][6]) 这不一定等价于“away from sensitive region”。如果无人机在敏感区域正上方，更向下可能反而更集中地看地面。

建议把策略名称改成：

```text
depth_limited_camera
narrowed_capture_range
inspection_focused_camera
```

如果真的要做 “gimbal away”，则需要根据 privacy target 的相对方位调整 yaw/pitch，使相机中心线偏离该 target，而不只是统一改变 pitch。

---

## 4. 实验条件隔离还要再加强

你已经明显改善了 C1/C2/C3。前端测试也验证了 C1 会隐藏 `Compare With Preferences` 和高级相机参数。([GitHub][3]) 但从 `App.tsx` 看，`Compute Exposure` 似乎仍然是全局按钮。([GitHub][7])

建议正式实验时这样处理：

| 条件                   | 允许显示                                                               | 不应显示                                                                |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| C1 Basic Notice      | 任务、时间、航线、高度、目的                                                     | Compute Exposure、相机参数、偏好标注、exposure surfaces                        |
| C2 Route + Footprint | 航线、UAV glyph、camera frustum/footprint                              | exposure score、sensitive exposure、semantic risk、preference response |
| C3 Visual Exposure   | 完整 exposure、surface inspection、preference drawing、planning options | 无                                                                   |

C1 中最好不要出现 `Compute Exposure`，否则用户会意识到系统还有更高级的暴露计算，只是当前条件没显示。这会污染实验。

---

## 5. 文档需要同步更新

现在 `docs/API.md` 还只写了 `/api/exposure/compute`、`/api/exposure/compare` 等内容，没有同步说明 `/api/planning/optimize`。([GitHub][8]) 但前端和后端已经实现了 planning optimize endpoint。([GitHub][2])

建议立刻补一个 API section：

```text
POST /api/planning/optimize
Purpose:
Generate privacy-aware route/camera alternatives from user-marked privacy areas.

Important boundary:
This is a deterministic candidate-based response generator, not an optimal planner.

Returns:
baseline_summary
options[]
  modified_route
  modified_camera
  sensitive_exposure_reduction_percent
  route_length_increase_percent
  coverage_loss_percent
  objective_terms
  explanation
```

`DEMO_SCRIPT.md` 也应加入 `Optimize for Privacy → Preview → Apply → Recompute Exposure` 的流程。目前 demo script 到 compare with preferences 为止，尚未明确覆盖 planning options。([GitHub][9])

---

## 6. 还缺两个正式用户实验必须有的模块

第一是 **experiment logging**。我没有看到独立 logger 或日志 API。对于 CHI controlled study，必须记录：

```text
condition
scenario
camera profile
layer toggles
surface clicks
preference polygon draw / close / clear
compute exposure
compare
optimize
preview option
apply option
final authorization decision
decision time
```

建议先做前端 JSONL 下载即可，不必上数据库。

第二是 **backend geometry validation**。现在 frontend tests 很丰富，但后端 exposure/planning 的几何正确性还需要最小测试。至少要有：

```text
single ground plane footprint test
wall occlusion test
altitude increases footprint / reduces recognizability test
do-not-capture polygon triggers target generation test
candidate route changes when target is near route
```

这类测试不只是工程质量问题，也能在论文里支撑 “estimated visual exposure” 不是随意画出来的。

---

## 7. 代码格式仍需要处理

GitHub raw view 里很多文件仍然显示为超长单行，包括 `main.py`、`exposure.py`、`App.tsx`、`api.ts`、`types.ts`、`package.json`、`requirements.txt`、`backend.yaml` 等。([GitHub][1])

如果这不是 web 工具显示问题，而是 repo 中真实格式，那么要尽快修。否则后续协作、review、artifact evaluation 都会受影响。建议加：

```text
Python: black, ruff, isort
TypeScript: prettier, eslint
YAML/JSON: prettier or yamllint
CI: npm run build, npm test, backend unit tests
```

尤其是 `backend.yaml`，如果真实文件确实是 raw view 这种单行结构，YAML 解析可能不稳定。最好确认本地文件是否是真正多行 YAML。

---

## 8. 我的总体判断

当前版本已经从 **inspect-only prototype** 进化到 **candidate-based privacy response prototype**。这是非常大的改进。现在可以开始做 internal pilot，但正式 CHI controlled study 前，我建议完成以下 5 件事：

1. 把 `Compare With Preferences` 改成 “preference-weighted exposure”，不要让它承担 privacy mitigation 的含义。
2. 把 `Optimize for Privacy` 改成 “Generate Privacy Options”，避免宣称最优规划。
3. route response 从 waypoint adjustment 升级到 sampled route / polygon-distance-based adjustment。
4. 补 experiment logging。
5. 补 backend geometry validation，并同步 API / demo 文档。

完成这几项后，这个系统就可以比较稳地支撑论文中的系统贡献和用户研究。

[1]: https://raw.githubusercontent.com/xiahaa/Visual-Exposure-CHI/main/backend/app/main.py "raw.githubusercontent.com"
[2]: https://raw.githubusercontent.com/xiahaa/Visual-Exposure-CHI/main/frontend/src/api.ts "raw.githubusercontent.com"
[3]: https://raw.githubusercontent.com/xiahaa/Visual-Exposure-CHI/main/frontend/src/App.test.tsx "raw.githubusercontent.com"
[4]: https://github.com/xiahaa/Visual-Exposure-CHI "GitHub - xiahaa/Visual-Exposure-CHI · GitHub"
[5]: https://raw.githubusercontent.com/xiahaa/Visual-Exposure-CHI/main/backend/app/services/exposure.py "raw.githubusercontent.com"
[6]: https://raw.githubusercontent.com/xiahaa/Visual-Exposure-CHI/main/backend/app/services/planning.py "raw.githubusercontent.com"
[7]: https://raw.githubusercontent.com/xiahaa/Visual-Exposure-CHI/main/frontend/src/App.tsx "raw.githubusercontent.com"
[8]: https://raw.githubusercontent.com/xiahaa/Visual-Exposure-CHI/main/docs/API.md "raw.githubusercontent.com"
[9]: https://raw.githubusercontent.com/xiahaa/Visual-Exposure-CHI/main/docs/DEMO_SCRIPT.md "raw.githubusercontent.com"
