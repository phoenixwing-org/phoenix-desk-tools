/**
 * Minimal excerpt from PNXBomAnalysisParam.h — Kevin Wizard END blank line + KEVIN_SYSTEM_CODE.
 * case_id=pnx-bom-param-min
 */
#ifndef PNXBomAnalysisParamMin_H
#define PNXBomAnalysisParamMin_H

class PNXBomAnalysisParamMin {
public:
    void setZebra();
    void getApple();

public:
    // START KEVIN CAA WIZARD SECTION PNXBomAnalysis PARAM DECLARATION

    // clang-format off
    /**
     * @brief Part Count
     * @id 3
     */
    int PartCount;

    /**
     * @brief Top Part Number
     * @id 2
     */
    CATUnicodeString FirstPartNumber;

    // clang-format on
    // END KEVIN CAA WIZARD SECTION PNXBomAnalysis PARAM DECLARATION

    std::vector<PNXBomItem>* productItems;

    /**
     * @brief Error Message List
     * @id 4
     */
    CATListOfCATUnicodeString errorMessage;

public: // KEVIN_SYSTEM_CODE
    // KEVIN_SYSTEM_CODE START
    static CATUnicodeString convertJson(const PNXBomItem& item);
    static int GetSoftwareVersion();
    // KEVIN_SYSTEM_CODE END

    CATUnicodeString ConvertErrorListToString() const;
};

#endif
