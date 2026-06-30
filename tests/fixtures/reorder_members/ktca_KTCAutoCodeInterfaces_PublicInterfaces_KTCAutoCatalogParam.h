/**
 * @copyright   Shanghai Kuntai Software Technology Co., Ltd. 2025
 * @license     MIT
 * @author      Phoenix Wing
 * @checkout    PNXAutoCode
 * @file
 * @version		V1.0
 * @brief
 * @details
 * @date		2025-12-17
 */

#ifndef KTCAutoCatalogParam_H
#define KTCAutoCatalogParam_H

#include "CATISpecObject.h"
#include "CATListOfCATUnicodeString.h"
#include "CATUnicodeString.h"

// KTC
#include "KTCAutoCatalogParam.h"
#include "KTCAutoCodeItf.h"

// std
#include <vector>

/** @brief KTC AutoCode Param */
class ExportedByKTCAutoCodeItf KTCAutoCatalogParam {
public:
    /** @brief Standard constructors and destructors */
    KTCAutoCatalogParam();
    virtual ~KTCAutoCatalogParam();

    /** @brief Copy constructor and equal operator */
    KTCAutoCatalogParam(const KTCAutoCatalogParam&);
    KTCAutoCatalogParam& operator=(const KTCAutoCatalogParam&);

public:
    static HRESULT add_Attributes(CATISpecObject*                   startUp,
                                  std::vector<KTCAutoCatalogParam>& itemList);
    void SetTKListValue(const CATUnicodeString& name, TCKind kind, CATAttrInOut in);

    void SetValue(const CATUnicodeString& name, TCKind kind, CATAttrInOut in);

public:
    CATUnicodeString name;
    TCKind           kind;
    CATAttrInOut     inOut;
    int              isList;
};

#endif
