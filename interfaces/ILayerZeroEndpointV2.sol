// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

struct SetConfigParam {
    uint32 eid;
    uint32 configType;
    bytes config;
}

/**
 * @title Interface for LayerZeroEndpointV2 used by OAPP Factory
 */
interface ILayerZeroEndpointV2 {
    function eid() external view returns (uint32);
    function setSendLibrary(address _oapp, uint32 _eid, address _newLib) external;
    function setReceiveLibrary(address _oapp, uint32 _eid, address _newLib, uint256 _gracePeriod) external;
    function getSendLibrary(address _sender, uint32 _eid) external view returns (address lib);
    function getReceiveLibrary(address _receiver, uint32 _eid) external view returns (address lib, bool isDefault);
    function setConfig(address _oapp, address _lib, SetConfigParam[] calldata _params) external;
    function getConfig(
        address _oapp,
        address _lib,
        uint32 _eid,
        uint32 _configType
    ) external view returns (bytes memory config);
    function delegates(address oapp) external view returns (address);
    function setReceiveLibraryTimeout(address _oapp, uint32 _eid, address _lib, uint256 _expiry) external;
}
