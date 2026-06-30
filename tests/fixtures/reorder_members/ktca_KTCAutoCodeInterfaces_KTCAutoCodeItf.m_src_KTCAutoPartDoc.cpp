/**
 * @copyright   Shanghai Kuntai Software Technology Co., Ltd. 2025
 * @license     MIT
 * @author      Phoenix Wing
 * @checkout    KTCAutoCode
 * @file  		KTCAutoPartDoc.cpp
 * @version		V1.0
 * @date		2025-12-17
 * @brief
 */

// cat
#include "CATFrmEditor.h"
#include "CATIBuildPath.h"
#include "CATIGSMTool.h"
#include "CATIMmiNonOrderedGeometricalSet.h"
#include "CATIPrtPart.h"
#include "CATPathElement.h"

// auto code
#include "KTCAutoDefine.h"
#include "KTCAutoGSM.h"
#include "KTCAutoPartDoc.h"

//-----------------------------------------------------------------------------
KTCAutoPartDoc::KTCAutoPartDoc()
    : catFrmEditor_(NULL)
    , gsmTool_(NULL) {

    // your code here:
}
//-----------------------------------------------------------------------------
KTCAutoPartDoc::~KTCAutoPartDoc() {
    catFrmEditor_ = NULL; // 不能释放
    KTCRelease(gsmTool_); // 手动释放
}
//-----------------------------------------------------------------------------
KTCAutoPartDoc::KTCAutoPartDoc(const KTCAutoPartDoc& iOriginal) {
}
//-----------------------------------------------------------------------------
KTCAutoPartDoc& KTCAutoPartDoc::operator=(const KTCAutoPartDoc& iOriginal) {
    return *this;
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoPartDoc::checkout_pathelement(CATISpecObject_var object,
                                             CATPathElement**   pathElement) {

    // check path element
    if (!pathElement) return E_INVALIDARG;
    *pathElement = NULL; // initialize

    // check object
    if (!object) return E_INVALIDARG;

    // parameters
    CATIBuildPath* buildPath = NULL;
    HRESULT        hr;

    // check editor
    if (!catFrmEditor_) {
        hr = initial_editor(NULL);
        if (FAILED(hr)) return hr;
    }

    // checkout build path
    hr = object->QueryInterface(IID_CATIBuildPath, (void**)&buildPath);
    if (FAILED(hr)) return hr;

    // check out path element
    CATPathElement context = catFrmEditor_->GetUIActiveObject();
    hr                     = buildPath->ExtractPathElement(&context, pathElement);
    KTCRelease(buildPath);
    return hr;
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoPartDoc::checkout_pathelement(const CATListValCATISpecObject_var& iList,
                                             CATLISTP(CATPathElement) & oList) {
    oList.RemoveAll(); // initialize

    if (0 == iList.Size()) return S_OK;

    // parameters
    CATPathElement* pathElement = NULL;
    HRESULT         hr;

    // checkout path element list from index 1
    for (int i = 1; i <= iList.Size(); i++) {
        hr = this->checkout_pathelement(iList[ i ], &pathElement);
        if (FAILED(hr)) return hr; // error
        oList.Append(pathElement);
    }

    return S_OK; // ok
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoPartDoc::initial_editor(CATFrmEditor* iEditor) {
    // 1. set to input editor
    if (iEditor) {
        catFrmEditor_ = iEditor;
        return S_OK;
    };

    // 2.already initialized
    if (catFrmEditor_) return S_OK;

    // 3. check and get current editor
    catFrmEditor_ = CATFrmEditor::GetCurrentEditor();
    if (!catFrmEditor_) return E_POINTER; // failed

    return S_OK; // ok
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoPartDoc::initial_GSMTool_From_GeomSet() {
    if (gsmTool_) return S_OK;

    return KTCAutoGSM::LookingForGeomSet(catFrmEditor_, &gsmTool_);
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoPartDoc::QueryInterface(const IID& iIID, void** oPPV) {
    return KTCAutoGSM::QueryInterface(gsmTool_, iIID, oPPV);
}
