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

#ifndef KTCAutoPartDoc_H
#define KTCAutoPartDoc_H

#include "CATIGSMTool.h"
#include "CATISpecObject.h"
#include "CATLISTV_CATISpecObject.h"
#include "CATListOfCATPathElement.h"
#include "CATListOfCATUnicodeString.h"
#include "CATUnicodeString.h"

// auto code
#include "KTCAutoCodeItf.h"
#include "KTCAutoPartDoc.h"

class CATFrmEditor;

/** @brief KTC AutoCode Param */
class ExportedByKTCAutoCodeItf KTCAutoPartDoc {
public:
    /** @brief Standard constructors and destructors */
    KTCAutoPartDoc();
    virtual ~KTCAutoPartDoc();

public:
    /**
     * @brief checkout path element
     * @param object CATISpecObject_var
     * @param pathElement CATPathElement**
     * @return HRESULT
     */
    HRESULT checkout_pathelement(CATISpecObject_var object, CATPathElement** pathElement);

    HRESULT checkout_pathelement(const CATListValCATISpecObject_var& list,
                                 CATPathElement**                    pathElement);

    /**
     * @brief checkout path element
     * @param iList CATListValCATISpecObject_var
     * @param oList CATListOfCATPathElement&
     * @return HRESULT
     */
    HRESULT checkout_pathelement(const CATListValCATISpecObject_var& iList,
                                 CATLISTP(CATPathElement) & oList);

    /**
     * @brief Get FrmEditor
     * @return  CATFrmEditor*, DONOT release outside
     * <br><b>Lifecycle rules deviation</b>: No AddRef is performed
     */
    inline CATFrmEditor* GetFrmEditor() const {
        return catFrmEditor_;
    };

    /**
     * @brief Get GSMTool
     * @return  CATIGSMTool*, DONOT release outside
     */
    inline CATIGSMTool* GetGSMTool() const {
        return gsmTool_;
    };

    /**
     * @brief initial editor
     * @param editor CATFrmEditor*
     * @return HRESULT
     */
    HRESULT initial_editor(CATFrmEditor* editor);

    /**
     * @brief initial editor from GeomSet and catFrmEditor_
     * @return HRESULT, set GSMTool in gsmTool_
     * get from GetGSMTool()
     */
    HRESULT initial_GSMTool_From_GeomSet();

    /**
     * @brief checktout interface from GSMTool
     * @param iIID input IID
     * @param oPPV out interface pointer
     * @return HRESULT
     */
    HRESULT QueryInterface(const IID& iIID, void** oPPV);

private:
    /** @brief Copy constructor and equal operator */
    KTCAutoPartDoc(const KTCAutoPartDoc&);
    KTCAutoPartDoc& operator=(const KTCAutoPartDoc&);

private:
    CATFrmEditor* catFrmEditor_; // catia frame editor
    CATIGSMTool*  gsmTool_;      // GSM Tool, do not release gsmTool_ outside
};

#endif
