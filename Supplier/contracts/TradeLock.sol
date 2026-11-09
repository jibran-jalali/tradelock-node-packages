// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice ETH escrow with a ten-hour window measured from the supplier's shipment.
contract TradeLock {
    // Existing values stay unchanged; Disputed and Refunded are appended.
    enum Status { Funded, Shipped, Paid, Disputed, Refunded }
    enum Resolution { None, PaySupplier, RefundBuyer }
    struct Trade {
        address buyer;
        address payable supplier;
        string description;
        uint256 quantity;
        uint256 amount;
        bytes32 documentHash;
        Status status;
        uint256 createdAt;
        uint256 shippedAt;
        uint256 releaseDeadline;
        string disputeReason;
        Resolution proposedResolution;
        address resolutionProposer;
    }

    mapping(uint256 => Trade) private trades;
    uint256 public tradeCount;
    uint256 public totalLocked;
    uint256 public constant RECEIPT_WINDOW = 10 hours;
    bool private entered;

    event TradeCreated(uint256 indexed tradeId, address indexed buyer, address indexed supplier, uint256 amount, bytes32 documentHash);
    event TradeShipped(uint256 indexed tradeId, address indexed supplier);
    event TradePaid(uint256 indexed tradeId, address indexed supplier, uint256 amount);
    event TradeRefunded(uint256 indexed tradeId, address indexed buyer, uint256 amount);
    event DisputeOpened(uint256 indexed tradeId, address indexed buyer, string reason);
    event ResolutionProposed(uint256 indexed tradeId, address indexed proposer, Resolution resolution);
    event ResolutionCancelled(uint256 indexed tradeId, address indexed proposer);
    event ResolutionAccepted(uint256 indexed tradeId, address indexed accepter, Resolution resolution);

    modifier nonReentrant() {
        require(!entered, "Reentrant call");
        entered = true;
        _;
        entered = false;
    }

    function createTrade(address payable supplier, string calldata description, uint256 quantity, bytes32 documentHash)
        external payable nonReentrant returns (uint256 id)
    {
        require(msg.value > 0, "Funding required");
        require(supplier != address(0) && supplier != address(this), "Invalid supplier");
        require(supplier != msg.sender, "Parties must differ");
        require(bytes(description).length > 0 && bytes(description).length <= 280, "Invalid description");
        require(quantity > 0, "Invalid quantity");
        require(documentHash != bytes32(0), "Invoice hash required");
        id = ++tradeCount;
        trades[id] = Trade({
            buyer: msg.sender, supplier: supplier, description: description,
            quantity: quantity, amount: msg.value, documentHash: documentHash,
            status: Status.Funded, createdAt: block.timestamp,
            shippedAt: 0, releaseDeadline: 0, disputeReason: "",
            proposedResolution: Resolution.None, resolutionProposer: address(0)
        });
        totalLocked += msg.value;
        emit TradeCreated(id, msg.sender, supplier, msg.value, documentHash);
    }

    function getTrade(uint256 id) public view returns (Trade memory) {
        require(id > 0 && id <= tradeCount, "Unknown trade");
        return trades[id];
    }

    function markShipped(uint256 id) external nonReentrant {
        Trade memory trade = getTrade(id);
        require(msg.sender == trade.supplier, "Supplier only");
        require(trade.status == Status.Funded, "Must be funded");
        trades[id].status = Status.Shipped;
        trades[id].shippedAt = block.timestamp;
        trades[id].releaseDeadline = block.timestamp + RECEIPT_WINDOW;
        _clearProposal(id);
        emit TradeShipped(id, msg.sender);
    }

    function confirmReceipt(uint256 id) external nonReentrant {
        Trade memory trade = getTrade(id);
        require(msg.sender == trade.buyer, "Buyer only");
        require(trade.status == Status.Shipped, "Must be shipped");
        _paySupplier(id, trade);
    }

    /// @notice Anyone can submit an overdue release; funds always go to the stored supplier.
    function claimPayment(uint256 id) external nonReentrant {
        Trade memory trade = getTrade(id);
        require(trade.status == Status.Shipped, "Must be shipped");
        require(block.timestamp >= trade.releaseDeadline, "Receipt window active");
        _paySupplier(id, trade);
    }

    /// @notice A timely buyer complaint freezes the deadline payment; no external verifier.
    function raiseDispute(uint256 id, string calldata reason) external nonReentrant {
        Trade memory trade = getTrade(id);
        require(msg.sender == trade.buyer, "Buyer only");
        require(trade.status == Status.Shipped, "Must be shipped");
        require(block.timestamp < trade.releaseDeadline, "Receipt window ended");
        require(bytes(reason).length > 0 && bytes(reason).length <= 280, "Invalid dispute reason");
        trades[id].status = Status.Disputed;
        trades[id].disputeReason = reason;
        _clearProposal(id);
        emit DisputeOpened(id, msg.sender, reason);
    }

    /// @notice Cancel an unshipped trade by agreement, or agree on a disputed trade's outcome.
    function proposeResolution(uint256 id, Resolution resolution) external nonReentrant {
        Trade memory trade = getTrade(id);
        _requireParty(trade);
        require(trade.status == Status.Funded || trade.status == Status.Disputed, "Resolution unavailable");
        require(resolution != Resolution.None, "Choose a resolution");
        require(trade.status != Status.Funded || resolution == Resolution.RefundBuyer, "Unshipped trades can only refund");
        trades[id].proposedResolution = resolution;
        trades[id].resolutionProposer = msg.sender;
        emit ResolutionProposed(id, msg.sender, resolution);
    }

    function cancelResolution(uint256 id) external nonReentrant {
        Trade memory trade = getTrade(id);
        require(trade.status == Status.Funded || trade.status == Status.Disputed, "Resolution unavailable");
        require(trade.resolutionProposer == msg.sender, "Proposer only");
        _clearProposal(id);
        emit ResolutionCancelled(id, msg.sender);
    }

    /// @notice Expected proposal fields stop an approval accepting a changed counterproposal.
    function acceptResolution(uint256 id, Resolution expectedResolution, address expectedProposer) external nonReentrant {
        Trade memory trade = getTrade(id);
        _requireParty(trade);
        require(trade.status == Status.Funded || trade.status == Status.Disputed, "Resolution unavailable");
        require(trade.proposedResolution != Resolution.None, "No proposal");
        require(trade.resolutionProposer != msg.sender, "Other party must approve");
        require(trade.proposedResolution == expectedResolution && trade.resolutionProposer == expectedProposer, "Proposal changed");
        _clearProposal(id);
        if (expectedResolution == Resolution.PaySupplier) {
            _paySupplier(id, trade);
        } else {
            trades[id].status = Status.Refunded;
            totalLocked -= trade.amount;
            (bool sent, ) = payable(trade.buyer).call{value: trade.amount}("");
            require(sent, "Buyer transfer failed");
            emit TradeRefunded(id, trade.buyer, trade.amount);
        }
        emit ResolutionAccepted(id, msg.sender, expectedResolution);
    }

    function _requireParty(Trade memory trade) private view {
        require(msg.sender == trade.buyer || msg.sender == trade.supplier, "Trade parties only");
    }

    function _clearProposal(uint256 id) private {
        trades[id].proposedResolution = Resolution.None;
        trades[id].resolutionProposer = address(0);
    }

    function _paySupplier(uint256 id, Trade memory trade) private {
        // Effects precede the external call. A failed transfer rolls all changes back.
        trades[id].status = Status.Paid;
        totalLocked -= trade.amount;
        (bool sent, ) = trade.supplier.call{value: trade.amount}("");
        require(sent, "Supplier transfer failed");
        emit TradePaid(id, trade.supplier, trade.amount);
    }
}
