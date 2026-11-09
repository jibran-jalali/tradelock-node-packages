// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface Escrow {
    function createTrade(address payable supplier, string calldata description, uint256 quantity, bytes32 documentHash) external payable returns (uint256);
    function markShipped(uint256 id) external;
    function confirmReceipt(uint256 id) external;
    function proposeResolution(uint256 id, uint8 resolution) external;
    function acceptResolution(uint256 id, uint8 resolution, address proposer) external;
    function raiseDispute(uint256 id, string calldata reason) external;
}

// Test fixture only: reject ETH or attempt a callback during payment.
contract TestSupplier {
    Escrow public escrow;
    bool public rejectPayment;
    bool public tryReentry;
    bool public reentrySucceeded;
    uint256 public target;
    constructor(address escrowAddress) { escrow = Escrow(escrowAddress); }
    function configure(bool reject, bool attack, uint256 id) external {
        rejectPayment = reject; tryReentry = attack; target = id;
    }
    function ship(uint256 id) external { escrow.markShipped(id); }
    function dispute(uint256 id, string calldata reason) external { escrow.raiseDispute(id, reason); }
    function propose(uint256 id, uint8 resolution) external { escrow.proposeResolution(id, resolution); }
    function accept(uint256 id, uint8 resolution, address proposer) external { escrow.acceptResolution(id, resolution, proposer); }
    function buy(address payable supplier, bytes32 hash) external payable {
        escrow.createTrade{value: msg.value}(supplier, "Callback target", 1, hash);
    }
    receive() external payable {
        require(!rejectPayment, "Rejected payment");
        if (tryReentry) {
            (reentrySucceeded, ) = address(escrow).call(abi.encodeCall(Escrow.confirmReceipt, (target)));
        }
    }
}
