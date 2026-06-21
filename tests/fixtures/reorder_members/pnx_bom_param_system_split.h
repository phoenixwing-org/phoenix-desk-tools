/**
 * PNXBomAnalysisParam-style: KEVIN_SYSTEM_CODE + public: // functions split.
 * case_id=pnx-bom-param-system-split
 */
#ifndef PNXBomParamSystemSplit_H
#define PNXBomParamSystemSplit_H

class PNXBomParamSystemSplit {
public:
    void setZebra();

public: // KEVIN_SYSTEM_CODE
    // KEVIN_SYSTEM_CODE START
    /**
     * @brief get the software version
     * @note KEVIN_SYSTEM_CODE
     */
    static int GetSoftwareVersion();
    // KEVIN_SYSTEM_CODE END

public: // functions
    /**
     * @brief convert Json
     */
    static CATUnicodeString convertJson(const PNXBomItem& item);

    /**
     * @brief Convert Error List to String
     * @note KEVIN_SYSTEM_CODE
     */
    CATUnicodeString ConvertErrorListToString() const;

    /**
     * @brief unrelated helper — must stay in functions section
     */
    void CheckoutAxis();
};

#endif
