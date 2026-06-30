/**
 * @copyright   Shanghai Kuntai Software Technology Co., Ltd. 2025
 * @license     MIT
 * @author      Phoenix Wing
 * @checkout    PNXAutoCode
 * @file
 * @version		V1.0
 * @brief
 * @details
 * @date		2025-1-19
 */

#ifndef KTCAutoBuildGSM_H
#define KTCAutoBuildGSM_H

#include "CATGeoFactory.h"
#include "CATIGeometricalElement.h"
#include "CATIMfProcReport.h"
#include "CATISpecObject.h"
#include "CATIUpdateError.h"
#include "CATListOfCATUnicodeString.h"
#include "CATSoftwareConfiguration.h"
#include "CATUnicodeString.h"

// KTC
#include "KTCAutoBuildGSM.h"
#include "KTCAutoCodeItf.h"

/** @brief KTC AutoCode Param */
class ExportedByKTCAutoCodeItf KTCAutoBuildGSM {
public:
    /** @brief Standard constructors and destructors */
    KTCAutoBuildGSM();
    virtual ~KTCAutoBuildGSM();

private:
    /** @brief Copy constructor and equal operator */
    KTCAutoBuildGSM(const KTCAutoBuildGSM&);
    KTCAutoBuildGSM& operator=(const KTCAutoBuildGSM&);

public:
    /** @brief query geomFactory from object */
    HRESULT query_factory(CATISpecObject_var object);

    /** @brief remove body from geomFactory */
    HRESULT remove(CATBody*& body);

public:
    CATIUpdateError*          updateError;
    CATIGeometricalElement*   geometricalElement;
    CATIMfProcReport*         procReport;
    CATGeoFactory*            geomFactory;
    CATSoftwareConfiguration* softConfig;
};

#endif
