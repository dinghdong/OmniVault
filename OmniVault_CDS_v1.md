# OmniVault 合约详细设计 (CDS) v1.0

> 基于 [架构图 v1.0](./OmniVault_Architecture_v1.md) 及 [PRD v1.0](./OmniVault_PRD_v1.md) 设计

---

## 1. 设计原则与约定

### 1.1 编码规范
* 编译器：`solidity ^0.8.24`
* 继承顺序（由底至深）：OpenZeppelin 基础合约 → 接口 → 模块合约
* 安全性：所有外部调用使用 `safeTransfer` / `safeTransferFrom`（通过 OpenZeppelin `SafeERC20`）
* 浮点数处理：所有比例以 Basis Points（1/10000）为单位存储，避免使用浮点数
* 地址类型：所有外部合约地址使用 `immutable` 或 `constant`，防止意外变更
* 代币精度：v1 仅支持原生 ETH，所有内部计算统一使用 18 位精度（1e18）；ETH 与 WETH/aWETH 均为 18 位精度，无精度转换需求

### 1.2 权限模型

| 角色 | 说明 |
|------|------|
| `owner` | 合约管理员，可升级合约、调整参数、暂停协议 |
| `aiOracle` | Chainlink Functions 回调地址，唯一可提交审计分数和触发投资的实体 |
| `riskAgent` | 风控 Agent 地址，唯一可触发熔断的实体 |
| `governance` | (v2) 治理多签，可裁决争议 |

> 所有角色均通过 OpenZeppelin `AccessControl` 管理，支持多签轮换。

### 1.3 存储布局约定
* 使用 EIP-7201 namespaced storage 避免升级合约时的存储冲突
* 关键状态变更均 emit Events，保证链上可追溯

---

## 2. 接口定义

### 2.1 `IAiOracle`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AI 预言机回调接口
/// @notice Chainlink Functions 审计完成后回调此接口提交结果
interface IAiOracle {
    /// @notice 审计完成回调
    /// @param projectId 项目 ID
    /// @param score 审计分数（0-100），若失败为 0
    /// @param scoreLow 分数区间下限（非确定性场景）
    /// @param scoreHigh 分数区间上限
    /// @param reportHash 审计报告的 IPFS 哈希（链下完整报告）
    /// @param nodeSignatures 节点签名列表，用于多节点共识验证
    function fulfillAudit(
        uint256 projectId,
        uint256 score,
        uint256 scoreLow,
        uint256 scoreHigh,
        bytes32 reportHash,
        bytes[] calldata nodeSignatures
    ) external;

    /// @notice 审计请求已超时/失败
    /// @param projectId 项目 ID
    /// @param reason 失败原因代码
    function fulfillAuditFailure(
        uint256 projectId,
        uint256 reason
    ) external;
}
```

### 2.2 `IInvestmentManager`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title 投资管理器接口
interface IInvestmentManager {
    /// @notice 执行投资（AI 审核通过后由 aiOracle 调用）
    /// @param projectId 项目 ID
    /// @param amount 投资金额（以 ETH 计价，18 位精度，wei）
    /// @param stakeAmount 项目方质押金额
    /// @param vestingSchedule 释放计划参数（编码后）
    function executeInvestment(
        uint256 projectId,
        uint256 amount,
        uint256 stakeAmount,
        bytes calldata vestingSchedule
    ) external;

    /// @notice 触发熔断，停止指定项目的所有后续释放
    /// @param projectId 项目 ID
    /// @param reason 熔断原因代码
    function triggerCircuitBreak(
        uint256 projectId,
        uint256 reason
    ) external;

    /// @notice 项目方提取当期可释放金额
    /// @param projectId 项目 ID
    function claimPayout(uint256 projectId) external;

    /// @notice 查询某项目当前可提取金额
    /// @param projectId 项目 ID
    function getClaimableAmount(uint256 projectId) external view returns (uint256);
}
```

---

## 3. 核心合约

### 3.1 `FundToken.sol` — Rebasing 份额代币

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title 基金 Rebasing 份额代币
/// @notice 类似于 AAVE 的 aToken，用户余额（balanceOf）随 accrualFactor 自动增长，
///         无需手动 claim。LP 持有 FundToken 即可享受基金收益。
///
/// @dev 设计原理（类 aToken）：
///      - shares[user]：用户持有的固定份额，由存款时确定，仅在存取时变化
///      - accrualFactor：全局收益累积因子，所有用户共享，初始为 1e18
///      - balanceOf(user) = shares[user] * accrualFactor / 1e18
///
///      收益实现时：accrualFactor 按比例放大，所有用户余额同比例增长
contract FundToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    /// @dev 精度：内部计算统一使用 18 位精度
    uint8 public constant DECIMALS = 18;

    /// @dev 全局收益累积因子（类似 aToken 的 conversionFactor）
    /// 初始为 1e18，代表 1 share = 1 ETH（18 位精度）
    /// 每次收益入账时等比放大，所有用户余额自动增长
    uint256 public accrualFactor = 1e18;

    /// @dev 用户份额账本：shares[user] 固定不变，仅在存款/赎回时增减
    mapping(address => uint256) public shares;

    /// @dev 历史 accrualFactor 快照（用于索引）
    uint256[] public accrualFactorHistory;

    // ─── Events ───
    event AccrualFactorUpdated(
        uint256 indexed newFactor,
        uint256 totalAssetsUnderManagement
    );

    constructor() ERC20("OmniVault Fund Token", "OVFT") {
        accrualFactorHistory.push(accrualFactor);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    modifier onlyMinter {
        require(hasRole(MINTER_ROLE, msg.sender), "Not minter");
        _;
    }

    modifier onlyBurner {
        require(hasRole(BURNER_ROLE, msg.sender), "Not burner");
        _;
    }

    // ─── 余额计算（自动复利）───
    /// @notice LP 真实余额 = 持有份额 × accrualFactor
    /// @dev 这是 Rebasing Token 的核心：余额随时间自动增长，无需 claim
    /// @param account LP 地址
    /// @return 用户当前可兑换的 ETH 数量（18 位精度，wei）
    function balanceOf(address account) public view override returns (uint256) {
        return shares[account] * accrualFactor / 1e18;
    }

    /// @notice 累计收益倍数（用于前端展示）
    /// @return factor / 1e18，即初始以来总收益倍数
    function cumulativeYield() external view returns (uint256) {
        return accrualFactor / 1e18;
    }

    // ─── 铸造（存款时调用）───
    /// @param to 接收地址
    /// @param sharesAmount 要铸造的份额数量（以 18 位精度）
    function mint(address to, uint256 sharesAmount) external onlyMinter {
        shares[to] += sharesAmount;
        _mint(to, sharesAmount); // ERC20 总量记账（内部用，不影响 balanceOf 计算）
        emit Transfer(address(0), to, sharesAmount);
    }

    // ─── 销毁（赎回时调用）───
    /// @param from 销毁地址
    /// @param sharesAmount 要销毁的份额数量（以 18 位精度）
    function burn(address from, uint256 sharesAmount) external onlyBurner {
        shares[from] -= sharesAmount;
        _burn(from, sharesAmount); // ERC20 总量记账
        emit Transfer(from, address(0), sharesAmount);
    }

    // ─── ERC20 兼容（转账时按 shares 而非余额转移）───
    /// @dev 标准 ERC20 转账的是余额（已复利的），这里改为转 shares
    ///      保持与传统 ERC20 行为一致：转多少余额，就对应多少 shares
    function transfer(address to, uint256 amount)
        public override returns (bool)
    {
        // amount 在这里是"余额"概念，需要转回 shares 再转
        uint256 sharesToTransfer = amount * 1e18 / accrualFactor;
        return super.transfer(to, sharesToTransfer);
    }

    function transferFrom(address from, address to, uint256 amount)
        public override returns (bool)
    {
        uint256 sharesToTransfer = amount * 1e18 / accrualFactor;
        return super.transferFrom(from, to, sharesToTransfer);
    }

    // ─── 收益入账（由 FundVault 调用）───
    /// @notice 更新全局收益因子（类似 aToken 的 rebase）
    /// @param yield 本次净收益（ETH 数量，18 位精度，wei）
    /// @param totalShares 当前总份额
    /// @dev newFactor = oldFactor + yield * oldFactor / totalAssets
    ///      = oldFactor * (totalAssets + yield) / totalAssets
    function applyYield(uint256 yield, uint256 totalShares) external onlyMinter {
        if (totalShares == 0 || yield == 0) return;

        uint256 oldFactor = accrualFactor;
        uint256 totalAssets = oldFactor * totalShares / 1e18;
        uint256 newFactor = oldFactor * (totalAssets + yield) / totalAssets;
        accrualFactor = newFactor;
        accrualFactorHistory.push(newFactor);

        emit AccrualFactorUpdated(newFactor, totalShares);
    }

    // ─── 亏损核销（由 FundVault 调用）───
    /// @notice 亏损时按比例缩减全局收益因子
    /// @param loss 本次净亏损（ETH 数量，18 位精度，wei）
    /// @param totalShares 当前总份额
    /// @dev newFactor = oldFactor × (totalAssets - loss) / totalAssets
    ///      factor 只降不升（历史已分配收益不受影响）
    /// @dev 当 loss >= totalAssets 时，factor 归零，所有余额归零
    function applyLoss(uint256 loss, uint256 totalShares) external onlyMinter {
        if (totalShares == 0 || loss == 0) return;

        uint256 oldFactor = accrualFactor;
        uint256 totalAssets = oldFactor * totalShares / 1e18;

        // 亏损后可用资产，亏损超过总资产则归零
        uint256 newAssets = totalAssets > loss ? totalAssets - loss : 0;
        uint256 newFactor = newAssets * 1e18 / totalShares;

        accrualFactor = newFactor;
        accrualFactorHistory.push(newFactor);

        emit AccrualFactorUpdated(newFactor, totalShares);
    }
}
```

### 3.2 `FundVault.sol` — 统一资金托管（v1: ETH-only）

> **v1 资金路径**：LP 充值 ETH → 合约包装为 WETH → supply 到 AAVE V3 → 持有 aWETH 生息。
> 赎回时反向：burn shares → 从 AAVE 撤回 WETH → unwrap → 发送 ETH 给 LP。

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { FundToken } from "./FundToken.sol";

/// @title 统一基金 Vault（ETH-only）
/// @notice 接收 LP 的 ETH，自动 wrap 为 WETH 并 supply 到 AAVE V3 赚取 aWETH 收益。
///         FundToken 采用 Rebasing 模型：LP 余额随 accrualFactor 自动复利增长。
contract FundVault is AccessControl {
    using SafeERC20 for IERC20;

    // ─── Access Roles ───
    bytes32 public constant INVESTOR_ROLE = keccak256("INVESTOR_ROLE"); // InvestmentManager

    // ─── Core Tokens ───
    IERC20 public immutable WETH;
    FundToken public immutable fundToken;
    address public immutable AAVE_POOL;
    IERC20 public immutable aWETH;

    // ─── Events ───
    event Deposited(
        address indexed LP,
        uint256 assets,     // ETH 数量（wei）
        uint256 shares      // 铸造的份额
    );
    event Redeemed(
        address indexed LP,
        uint256 shares,     // 销毁的份额
        uint256 assets      // 返还的 ETH（wei）
    );
    event Invested(uint256 amount);
    event Divested(uint256 amount);

    // ─── Errors ───
    error ZeroAmount();
    error AaveSupplyFailed();
    error AaveWithdrawFailed();
    error InsufficientBalance();

    constructor(
        address _weth,
        address _aavePool,
        address _aWeth,
        address _fundToken
    ) {
        WETH = IERC20(_weth);
        AAVE_POOL = _aavePool;
        aWETH = IERC20(_aWeth);
        fundToken = FundToken(_fundToken);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ─── ETH Reception ───
    /// @notice unwrap 后 WETH 退款的接收入口；同时支持直接收 ETH 并自动 wrap
    receive() external payable {
        IWETH(address(WETH)).deposit{value: msg.value}();
    }

    // ─── LP 充值（payable）───
    /// @notice LP 直接发送 ETH，合约自动 wrap 并 supply 到 AAVE
    /// @return shares 铸造的 FundToken 份额（18 位精度）
    function deposit() external payable returns (uint256 shares) {
        uint256 assets = msg.value;
        if (assets == 0) revert ZeroAmount();

        // 1. wrap ETH → WETH
        IWETH(address(WETH)).deposit{value: assets}();

        // 2. 授权 AAVE 并 supply（自动开始生息）
        _approveAndSupply(assets);

        // 3. 按当前 accrualFactor 计算应得份额（assets 与 factor 均为 18 位精度）
        //    accrualFactor = 1e18 时，1 ETH = 1 share（初始状态）
        //    accrualFactor = 1.05e18 时，1 ETH ≈ 0.952 share（新 LP 公平接入，老 LP 已享收益）
        shares = assets * 1e18 / fundToken.accrualFactor();

        // 4. 铸造份额
        fundToken.mint(msg.sender, shares);

        emit Deposited(msg.sender, assets, shares);
    }

    // ─── LP 赎回 ───
    /// @notice LP 销毁 FundToken 份额，按当前 accrualFactor 赎回 ETH
    /// @param shares 要销毁的原始份额（注意：传 `getShares()` 返回值，而非 `balanceOf()`）
    /// @return assets 返还的 ETH 数量（wei）
    function redeem(uint256 shares) external returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();

        // 1. 上限保护：防止 shares × accrualFactor 溢出
        uint256 total = fundToken.totalSupply();
        if (shares > total) shares = total;

        // 2. 按当前 accrualFactor 计算可换 ETH（均为 18 位精度，直接相乘）
        assets = shares * fundToken.accrualFactor() / 1e18;

        // 3. 从 AAVE 撤回 WETH
        _withdrawFromAave(assets);

        // 4. unwrap WETH → ETH
        IWETH(address(WETH)).withdraw(assets);

        // 5. 销毁份额
        fundToken.burn(msg.sender, shares);

        // 6. 转 ETH 给 LP
        (bool success, ) = msg.sender.call{value: assets}("");
        require(success, "ETH transfer failed");

        emit Redeemed(msg.sender, shares, assets);
    }

    /// @notice 查询 LP 真实余额（以 ETH 计价，已复利）
    function balanceOf(address lp) external view returns (uint256) {
        return fundToken.balanceOf(lp);
    }

    // ─── 投资相关（由 InvestmentManager 调用）───
    /// @notice 从 AAVE 撤回 WETH 并转给调用者（InvestmentManager 负责后续 unwrap 与拨款）
    /// @dev 仅限 INVESTOR_ROLE 调用
    function divestForInvestment(uint256 amount) external onlyRole(INVESTOR_ROLE) {
        _withdrawFromAave(amount);
        WETH.safeTransfer(msg.sender, amount);
        emit Invested(amount);
    }

    /// @notice 收到项目退出收益，复利到 accrualFactor
    /// @param proceeds 净收益（ETH/WETH 计价，18 位精度）
    function addRealizedGains(uint256 proceeds, uint256 /* originalAmount */)
        external onlyRole(INVESTOR_ROLE)
    {
        uint256 netGain = proceeds;

        uint256 currentShares = fundToken.totalSupply();
        if (netGain > 0 && currentShares > 0) {
            // 18 位精度直接复利，无需 scaling
            fundToken.applyYield(netGain, currentShares);
        }
    }

    /// @notice 收到项目亏损报告，核销 accrualFactor
    /// @param recoveredAmount 已追回金额（ETH 计价，可能为 0）
    /// @param originalAmount 原始投资本金（ETH 计价）
    /// @dev 亏损 = 本金 - 已追回；factor 缩小，所有 LP 余额同比例缩水
    function addRealizedLoss(uint256 recoveredAmount, uint256 originalAmount)
        external onlyRole(INVESTOR_ROLE)
    {
        uint256 netLoss = originalAmount > recoveredAmount
            ? originalAmount - recoveredAmount
            : 0;

        uint256 currentShares = fundToken.totalSupply();
        if (netLoss > 0 && currentShares > 0) {
            fundToken.applyLoss(netLoss, currentShares);
        }
    }

    // ─── 私有方法 ───
    function _approveAndSupply(uint256 amount) internal {
        WETH.forceApprove(AAVE_POOL, amount);
        // AAVE V3 supply(address asset, uint256 amount, address onBehalf, uint16 referralCode)
        (bool success, ) = AAVE_POOL.call(
            abi.encodeWithSignature(
                "supply(address,uint256,address,uint16)",
                address(WETH),
                amount,
                address(this),
                0
            )
        );
        if (!success) revert AaveSupplyFailed();
    }

    function _withdrawFromAave(uint256 amount) internal {
        uint256 aaveBalance = aWETH.balanceOf(address(this));
        uint256 toWithdraw = amount <= aaveBalance ? amount : aaveBalance;
        if (toWithdraw == 0) revert InsufficientBalance();

        (bool success, ) = AAVE_POOL.call(
            abi.encodeWithSignature(
                "withdraw(address,uint256,address)",
                address(WETH),
                toWithdraw,
                address(this)
            )
        );
        if (!success) revert AaveWithdrawFailed();
    }
}

/// @title IWETH — WETH 接口（deposit / withdraw）
interface IWETH {
    function deposit() external payable;
    function withdraw(uint256) external;
}
```

### 3.3 `InvestmentManager.sol` — 投资项目与分期拨款

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { IInvestmentManager } from "./interfaces/IInvestmentManager.sol";
import { IFundVault } from "./interfaces/IFundVault.sol";

/// @title 投资管理器
/// @notice 管理项目申请、AI 审核触发、投资执行、分期释放
contract InvestmentManager is AccessControl, IInvestmentManager {

    // ─── Access Roles ───
    bytes32 public constant AI_ORACLE_ROLE = keccak256("AI_ORACLE_ROLE");
    bytes32 public constant RISK_AGENT_ROLE = keccak256("RISK_AGENT_ROLE");

    // ─── Project State ───
    enum ProjectStatus {
        None,
        Pending,        // 已申请，待审计
        Auditing,       // 审计中
        Approved,       // 审计通过，待拨款
        Rejected,       // 审计拒绝
        Active,         // 投资执行中（分期拨付）
        CircuitBroken,  // 熔断
        Exited,         // 正常退出
        WriteOff        // 亏损核销
    }

    struct Project {
        address applicant;           // 项目方地址
        bytes32 commitHash;          // GitHub Commit Hash
        address contractAddr;        // 目标合约地址
        string bizApi;              // 业务数据 API
        ProjectStatus status;
        uint256 auditScore;
        uint256 auditScoreLow;
        uint256 auditScoreHigh;
        bytes32 auditReportHash;     // IPFS 审计报告哈希
        uint256 investmentAmount;    // 总投资金额
        uint256 releasedAmount;      // 已释放金额
        uint256 stakeAmount;         // 项目方质押金额
        uint256 submittedAt;
        uint256 auditedAt;
        uint256 exitedAt;
        uint256 exitProceeds;        // 退出收益
    }

    // ─── Storage ───
    mapping(uint256 => Project) public projects;
    uint256 public projectCount;

    // Vesting schedules: projectId => encoded VestingSchedule
    mapping(uint256 => bytes) public vestingSchedules;

    // ─── FundVault Reference ───
    IFundVault public immutable fundVault;

    // ─── Parameters ───
    uint256 public constant SCORE_THRESHOLD = 8000;          // 80.00% (Basis Points)
    uint256 public constant MAX_SCORE_DIFF = 2000;            // 20.00 分差阈值
    uint256 public constant DEFAULT_STAKE_RATIO = 2000;       // 基准质押比例 20%
    uint256 public constant REDEMPTION_LIMIT_BP = 1000;       // 单次赎回上限 10%

    // ─── Events ───
    event ProjectSubmitted(
        uint256 indexed projectId,
        address indexed applicant,
        bytes32 commitHash,
        address contractAddr
    );
    event AuditCompleted(
        uint256 indexed projectId,
        uint256 score,
        uint256 scoreLow,
        uint256 scoreHigh,
        bytes32 reportHash
    );
    event InvestmentExecuted(uint256 indexed projectId, uint256 amount);
    event PayoutClaimed(uint256 indexed projectId, uint256 amount);
    event CircuitBroken(uint256 indexed projectId, uint256 reason);
    event ProjectExited(uint256 indexed projectId, uint256 proceeds, bool isProfit);
    event ProjectWriteOff(uint256 indexed projectId, uint256 originalAmount, uint256 recoveredAmount);
    event Slashed(uint256 indexed projectId, uint256 amount);

    // ─── Errors ───
    error ProjectNotFound();
    error InvalidStatus(ProjectStatus required, ProjectStatus actual);
    error Unauthorized();
    error ZeroAmount();

    constructor(address _fundVault) {
        fundVault = IFundVault(_fundVault);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ─── 项目申请 ───
    function submitProject(
        bytes32 commitHash,
        address contractAddr,
        string calldata bizApi,
        uint256 stakeAmount,
        address /* stakeToken */
    ) external returns (uint256 projectId) {
        if (commitHash == bytes32(0) || contractAddr == address(0))
            revert ZeroAmount();

        projectId = ++projectCount;
        Project storage p = projects[projectId];

        p.applicant = msg.sender;
        p.commitHash = commitHash;
        p.contractAddr = contractAddr;
        p.bizApi = bizApi;
        p.status = ProjectStatus.Pending;
        p.submittedAt = block.timestamp;
        p.stakeAmount = stakeAmount;

        emit ProjectSubmitted(projectId, msg.sender, commitHash, contractAddr);

        _requestAudit(projectId);
    }

    // ─── AI 审计回调 ───
    function fulfillAudit(
        uint256 projectId,
        uint256 score,
        uint256 scoreLow,
        uint256 scoreHigh,
        bytes32 reportHash,
        bytes[] calldata /* nodeSignatures */
    ) external onlyRole(AI_ORACLE_ROLE) {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Auditing)
            revert InvalidStatus(ProjectStatus.Auditing, p.status);

        p.auditScore = score;
        p.auditScoreLow = scoreLow;
        p.auditScoreHigh = scoreHigh;
        p.auditReportHash = reportHash;
        p.auditedAt = block.timestamp;

        emit AuditCompleted(projectId, score, scoreLow, scoreHigh, reportHash);

        if (score >= SCORE_THRESHOLD) {
            p.status = ProjectStatus.Approved;
        } else {
            p.status = ProjectStatus.Rejected;
        }
    }

    function fulfillAuditFailure(uint256 projectId, uint256 /* reason */)
        external onlyRole(AI_ORACLE_ROLE)
    {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Auditing)
            revert InvalidStatus(ProjectStatus.Auditing, p.status);
        p.status = ProjectStatus.Rejected;
    }

    // ─── 执行投资 ───
    function executeInvestment(
        uint256 projectId,
        uint256 amount,
        uint256 stakeAmount,
        bytes calldata vestingSchedule
    ) external onlyRole(AI_ORACLE_ROLE) {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Approved)
            revert InvalidStatus(ProjectStatus.Approved, p.status);
        if (amount == 0) revert ZeroAmount();

        // 从 FundVault（AAVE）赎回并锁定
        fundVault.divestForInvestment(amount);

        p.investmentAmount = amount;
        p.status = ProjectStatus.Active;
        p.stakeAmount = stakeAmount;
        vestingSchedules[projectId] = vestingSchedule;

        emit InvestmentExecuted(projectId, amount);
    }

    // ─── 分期释放 ───
    function claimPayout(uint256 projectId) external {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Active && p.status != ProjectStatus.CircuitBroken)
            revert InvalidStatus(ProjectStatus.Active, p.status);

        uint256 claimable = getClaimableAmount(projectId);
        if (claimable == 0) revert ZeroAmount();

        p.releasedAmount += claimable;
        // v1: 项目方按 vesting schedule 领取 ETH（合约持有的 WETH 由 InvestmentManager unwrap 后转账）
        IWETH(fundVault.WETH()).withdraw(claimable);
        (bool ok, ) = p.applicant.call{value: claimable}("");
        require(ok, "ETH payout failed");

        emit PayoutClaimed(projectId, claimable);
    }

    function getClaimableAmount(uint256 projectId)
        public view returns (uint256)
    {
        Project memory p = projects[projectId];
        if (p.status != ProjectStatus.Active) return 0;

        uint256 total = p.investmentAmount;
        uint256 firstRelease = total * 2000 / 10000; // 首期 20%
        uint256 linearPart = total - firstRelease;

        uint256 vestingDuration = 52 weeks;
        uint256 elapsed = block.timestamp - p.auditedAt;

        if (elapsed >= vestingDuration) {
            return total - p.releasedAmount;
        }

        uint256 linearVested = linearPart * elapsed / vestingDuration;
        uint256 totalVested = firstRelease + linearVested;

        return totalVested > p.releasedAmount
            ? totalVested - p.releasedAmount
            : 0;
    }

    // ─── 熔断 ───
    function triggerCircuitBreak(uint256 projectId, uint256 reason)
        external onlyRole(RISK_AGENT_ROLE)
    {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Active && p.status != ProjectStatus.Auditing)
            revert InvalidStatus(ProjectStatus.Active, p.status);

        p.status = ProjectStatus.CircuitBroken;

        uint256 unreleased = projects[projectId].investmentAmount
            - projects[projectId].releasedAmount;
        uint256 slashAmount = unreleased > p.stakeAmount
            ? p.stakeAmount
            : unreleased;

        if (slashAmount > 0) {
            emit Slashed(projectId, slashAmount);
        }

        emit CircuitBroken(projectId, reason);
    }

    // ─── 项目退出（正常退出，有回款）───
    function markExit(uint256 projectId, uint256 exitProceeds) external {
        Project storage p = projects[projectId];
        require(
            p.status == ProjectStatus.Active ||
            p.status == ProjectStatus.CircuitBroken,
            "Invalid status"
        );

        p.status = ProjectStatus.Exited;
        p.exitedAt = block.timestamp;
        p.exitProceeds = exitProceeds;

        bool isProfit = exitProceeds >= p.investmentAmount;
        if (isProfit) {
            // 盈利或保本：计算净收益，复利分配
            fundVault.addRealizedGains(exitProceeds, p.investmentAmount);
        } else {
            // 亏损但有回款：亏损核销 + 剩余回款复利
            fundVault.addRealizedLoss(exitProceeds, p.investmentAmount);
        }

        emit ProjectExited(projectId, exitProceeds, isProfit);
    }

    // ─── 项目核销（完全亏损，无回款）───
    /// @notice 项目彻底失败，无任何回款，触发全额亏损核销
    function markWriteOff(uint256 projectId) external onlyRole(RISK_AGENT_ROLE) {
        Project storage p = projects[projectId];
        require(
            p.status == ProjectStatus.Active ||
            p.status == ProjectStatus.CircuitBroken,
            "Invalid status"
        );

        p.status = ProjectStatus.WriteOff;
        p.exitedAt = block.timestamp;

        // 全额亏损核销（无任何回款）
        fundVault.addRealizedLoss(0, p.investmentAmount);

        emit ProjectWriteOff(projectId, p.investmentAmount, 0);
    }

    // ─── 私有方法 ───
    function _requestAudit(uint256 projectId) internal {
        Project storage p = projects[projectId];
        p.status = ProjectStatus.Auditing;
        // 调用 Chainlink Functions 发送审计请求
        // _sendChainlinkFunctionsRequest(projectId);
    }
}
```

### 3.4 `PromptRegistry.sol` — 提示词哈希注册

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title 提示词哈希注册表
/// @notice 存储提示词的 Commitment（哈希），允许任何人验证提示词完整性
/// @dev 提示词本体存于链下，合约仅存储哈希用于公开验证
contract PromptRegistry {

    struct PromptEntry {
        bytes32 commitment;      // 提示词 SHA-256 哈希
        string name;            // 提示词名称（如 "audit-v1.2"）
        uint256 version;         // 版本号
        uint256 activeFrom;      // 激活时间戳
        bool isActive;           // 是否当前激活版本
    }

    mapping(bytes32 => PromptEntry) public prompts;
    bytes32 public activePromptId;

    event PromptRegistered(bytes32 indexed promptId, string name, bytes32 commitment);
    event PromptActivated(bytes32 indexed promptId);

    /// @notice 注册新提示词（仅 owner）
    function registerPrompt(
        bytes32 promptId,
        bytes32 commitment,
        string calldata name
    ) external onlyOwner {
        prompts[promptId] = PromptEntry({
            commitment: commitment,
            name: name,
            version: prompts[promptId].version + 1,
            activeFrom: block.timestamp,
            isActive: false
        });
        emit PromptRegistered(promptId, name, commitment);
    }

    /// @notice 激活提示词版本（仅 owner）
    function activatePrompt(bytes32 promptId) external onlyOwner {
        if (activePromptId != bytes32(0)) {
            prompts[activePromptId].isActive = false;
        }
        prompts[promptId].isActive = true;
        activePromptId = promptId;
        emit PromptActivated(promptId);
    }

    /// @notice 验证提示词完整性
    function verifyPrompt(
        bytes32 promptId,
        string calldata promptContent
    ) external view returns (bool) {
        return prompts[promptId].commitment ==
            sha256(abi.encodePacked(promptContent));
    }
}
```

### 3.5 `AuditTrail.sol` — 决策审计追踪

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title 操作审计追踪
/// @notice 记录每次 AI 决策的哈希，确保过程可追溯、不可篡改
contract AuditTrail {

    struct AuditRecord {
        uint256 projectId;
        uint256 timestamp;
        bytes32 inputHash;     // 审计输入（代码 + 提示词哈希）的哈希
        bytes32 outputHash;    // AI 输出（分数 + 报告哈希）
        bytes32 nodeSetHash;   // 参与节点的集合哈希
        uint256 nodeCount;     // 参与节点数
    }

    mapping(uint256 => AuditRecord[]) public auditRecords;
    mapping(uint256 => uint256) public auditCount;

    event AuditRecorded(
        uint256 indexed projectId,
        bytes32 inputHash,
        bytes32 outputHash,
        bytes32 nodeSetHash,
        uint256 nodeCount
    );

    function recordAudit(
        uint256 projectId,
        bytes32 inputHash,
        bytes32 outputHash,
        bytes32 nodeSetHash,
        uint256 nodeCount
    ) external onlyAiOracle {
        auditRecords[projectId].push(AuditRecord({
            projectId: projectId,
            timestamp: block.timestamp,
            inputHash: inputHash,
            outputHash: outputHash,
            nodeSetHash: nodeSetHash,
            nodeCount: nodeCount
        }));
        auditCount[projectId]++;
        emit AuditRecorded(projectId, inputHash, outputHash, nodeSetHash, nodeCount);
    }

    function verifyAuditRecord(
        uint256 projectId,
        uint256 index,
        bytes32 inputHash,
        bytes32 outputHash
    ) external view returns (bool) {
        AuditRecord memory record = auditRecords[projectId][index];
        return record.inputHash == inputHash && record.outputHash == outputHash;
    }
}
```

---

## 4. 函数权限矩阵

| 函数 | `owner` | `AI_ORACLE_ROLE` | `RISK_AGENT_ROLE` | `INVESTOR_ROLE` | 公开 |
|------|---------|-------------------|-------------------|-----------------|------|
| `FundVault.deposit()` | — | — | — | — | ✅ LP |
| `FundVault.redeem()` | — | — | — | — | ✅ LP |
| `FundVault.divestForInvestment()` | — | — | — | ✅ | — |
| `FundVault.addRealizedGains()` | — | — | — | ✅ | — |
| `FundToken.applyYield()` | — | — | — | ✅ | — |
| `InvestmentManager.submitProject()` | — | — | — | — | ✅ 项目方 |
| `InvestmentManager.executeInvestment()` | — | ✅ | — | — | — |
| `InvestmentManager.triggerCircuitBreak()` | — | — | ✅ | — | — |
| `InvestmentManager.claimPayout()` | — | — | — | — | ✅ 项目方 |
| `InvestmentManager.markExit()` | ✅ | — | — | — | ✅ |
| `PromptRegistry.registerPrompt()` | ✅ | — | — | — | — |
| `PromptRegistry.activatePrompt()` | ✅ | — | — | — | — |

---

## 5. Rebasing Factor 计算

### 5.1 核心公式

```
// ── 盈利时 ──
accrualFactor_new = accrualFactor_old × (totalAssets + netGain) / totalAssets

// ── 亏损时 ──
accrualFactor_new = accrualFactor_old × (totalAssets - netLoss) / totalAssets

其中：
  - totalAssets = AAVE aWETH 余额 + 已累计净收益（以 FundToken 价值计，ETH 计价）
  - netGain = 项目退出净收益（退出收益 - 原始投资本金）
  - netLoss = 项目亏损（原始投资本金 - 已追回金额）

用户余额 = shares[user] × accrualFactor / 1e18
```

### 5.2 场景示例

```
初始状态：
  accrualFactor = 1e18（= 1.0）
  LP A 存 1000 ETH → shares = 1000
  LP A balanceOf = 1000 × 1.0 = 1000 ETH (rebased 余额)

项目 B 退出，收益 100 ETH（本金 80 ETH）：
  netGain = 20 ETH（盈利）
  accrualFactor_new = 1e18 × (1000 + 20) / 1000 = 1.02e18
  LP A balanceOf = 1000 × 1.02 = 1020 ETH ← 自动增长

新 LP C 存入 1020 ETH：
  shares = 1020 / 1.02 = 1000（公平接入）
```

### 5.3 亏损场景

```
项目 C 失败，只追回 30 ETH（本金 100 ETH）：
  netLoss = 100 - 30 = 70 ETH
  accrualFactor_new = 1.02e18 × (1020 - 70) / 1020 ≈ 0.952e18
  LP A balanceOf = 1000 × 0.952 ≈ 952 ETH ← 自动缩水
  LP A 亏损 = 1020 - 952 = 68 ETH（已实现）

项目 D 彻底失败，0 回款（本金 50 ETH）：
  netLoss = 50 - 0 = 50 ETH
  accrualFactor_new = 0.952e18 × (952 - 50) / 952 ≈ 0.902e18
  LP A balanceOf = 1000 × 0.902 ≈ 902 ETH
```

### 5.4 与 aToken 的类比

| 维度 | AAVE aToken | OmniVault FundToken |
|------|------------|---------------------|
| 底层资产 | 借款利息 | 投资收益 + AAVE 利息 |
| 余额变化 | 借款利息自动入账 | 退出收益/亏损时 factor 同比例缩放 |
| 触发方式 | 借款人付息时自动 rebase | 项目退出时手动 applyYield / applyLoss |
| 本金保护 | aWETH 余额理论上可能 < 存款本金 | factor 同步反映亏损，所有 LP 按比例承担 |

> **设计原则**：factor 只记录已实现的净盈亏（realized P&L）。未实现收益（项目还在运营中）不计入 factor，LP 的余额也不会变化。

---

## 6. 升级策略

> 核心合约采用 **UUPS Proxy** 模式（EIP-1967）

```
TransparentUpgradeableProxy (EIP-1967)
    └── FundVaultImpl (UUPS)
    └── FundTokenImpl (UUPS)
    └── InvestmentManagerImpl (UUPS)
    └── PromptRegistryImpl (UUPS)
    └── AuditTrailImpl (UUPS)
```

* 每个模块独立升级，通过 `UUPSUpgradeable`
* `FundToken` 升级时需注意 `accrualFactor` 迁移
* 部署初期 `owner` 转移至 3/5 Gnosis Safe 多签

---

## 7. 待明确事项

| # | 事项 | 优先级 |
|---|------|--------|
| 1 | LP 单次赎回上限（当前设为 10%）是否合理 | 高 |
| 2 | AAVE 赎回失败（流动性枯竭）时的处理策略 | 高 |
| 3 | 项目退出收益的 Carry（绩效费）分配机制 | 中 |
| 4 | 项目方质押代币是否支持 ETH（原生币） | 中 |
| 5 | Chainlink Functions 回调 gas 预付方式 | 高 |
| 6 | 多节点签名验证阈值（至少几个节点才接受） | 高 |
| 7 | 亏损场景下 LP 的实际损失是否由 factor 不降来体现（即 LP 无法完整拿回本金）| 高 |
