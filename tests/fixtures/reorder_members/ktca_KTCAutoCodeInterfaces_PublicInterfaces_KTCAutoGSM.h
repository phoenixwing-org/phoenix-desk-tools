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

#ifndef KTCAutoGSM_H
#define KTCAutoGSM_H

#include "CATIGSMTool.h"
#include "CATISpecObject.h"
#include "CATListOfCATUnicodeString.h"
#include "CATUnicodeString.h"

// KTC
#include "KTCAutoCodeItf.h"
#include "KTCAutoGSM.h"

class CATFrmEditor;
class CATIPrtPart;

/** @brief KTC AutoCode Param */
class ExportedByKTCAutoCodeItf KTCAutoGSM {
public:
    /** @brief Standard constructors and destructors */
    KTCAutoGSM();
    virtual ~KTCAutoGSM();

private:
    /** @brief Copy constructor and equal operator */
    KTCAutoGSM(const KTCAutoGSM&);
    KTCAutoGSM& operator=(const KTCAutoGSM&);

public:
    /**
     * @brief Looking For Any Type Of Body
     * @param ipIPrtPart input CATIPrtPart* pointer
     * @param oppiGsmtool output CATIGSMTool** pointer
     * @return HRESULT
     */
    static HRESULT CreateTool(CATIPrtPart* ipIPrtPart, CATIGSMTool** oppiGsmtool);

    /**
     * @brief Checks if thefeature is inside an Ordered Geometrical Set
     * @param feature CATISpecObject
     * @return bool
     */
    static bool IsInsideOrderedBody(CATISpecObject_var feature);

    /**
     * @brief Looking For Any Type Of Body
     * @param iCatFrmEditor input CATFrmEditor* pointer
     * @param oppiGsmtool output CATIGSMTool** pointer
     * @return HRESULT
     */
    static HRESULT LookingForAnyTypeOfBody(CATFrmEditor* iCatFrmEditor, CATIGSMTool** oppiGsmtool);

    /**
     * @brief Looking For GeomSet
     * @param iCatFrmEditor input CATFrmEditor* pointer
     * @param oppiGsmtool output CATIGSMTool** pointer
     * @return HRESULT
     */
    static HRESULT LookingForGeomSet(CATFrmEditor* iCatFrmEditor, CATIGSMTool** oppiGsmtool);

    /**
     * @brief Looking For GeomSet Or Ordered GeomSet
     * @param iCatFrmEditor input CATFrmEditor* pointer
     * @param oppiGsmtool output CATIGSMTool** pointer
     * @return HRESULT
     */
    static HRESULT LookingForGeomSetOrOrderedGeomSet(CATFrmEditor* iCatFrmEditor,
                                                     CATIGSMTool** oppiGsmtool);

    /**
     * @brief checktout interface from GSMTool
     * @param ipiGSMTool input GSMTool
     * @param iIID input IID
     * @param oPPV out interface pointer
     * @return HRESULT
     */
    static HRESULT QueryInterface(CATIGSMTool* ipiGSMTool, const IID& iIID, void** oPPV);
};

#endif
