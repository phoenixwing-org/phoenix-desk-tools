/**
 * @copyright   Shanghai Kuntai Software Technology Co., Ltd. 2025
 * @license     MIT
 * @author      Phoenix Wing
 * @checkout    KTCAutoCode
 * @file  		KTCAutoBuildGSM.cpp
 * @brief
 */

#include "CATDocument.h"
#include "CATGeoFactory.h"
#include "CATGeometry.h"
#include "CATICGMObject.h"
#include "CATIContainer.h"
#include "CATIContainerOfDocument.h"
#include "CATIGeometricalElement.h" // Needed for DeleteScope and GetBodyResult
#include "CATILinkableObject.h"
#include "iostream.h"

// Local
#include "KTCAutoBuildGSM.h"

// auto code
#include "KTCAutoBody.h"
#include "KTCAutoDefine.h"
#include "KTCAutoErrors.h"
#include "KTCAutoPartDoc.h"

//-----------------------------------------------------------------------------
KTCAutoBuildGSM::KTCAutoBuildGSM()
    : updateError(NULL)
    , geometricalElement(NULL)
    , procReport(NULL)
    , geomFactory(NULL)
    , softConfig(NULL) {

    // your code here:
}
//-----------------------------------------------------------------------------
KTCAutoBuildGSM::~KTCAutoBuildGSM() {

    KTCRelease(geometricalElement); // 手动释放
    KTCRelease(updateError);        // 手动释放
    KTCRelease(procReport);         // 手动释放 the procedural report
    KTCRelease(softConfig);         // 手动释放 the software configuration
    KTCRelease(geomFactory);        // 手动释放
}
//-----------------------------------------------------------------------------
KTCAutoBuildGSM::KTCAutoBuildGSM(const KTCAutoBuildGSM& iOriginal) {
}
//-----------------------------------------------------------------------------
KTCAutoBuildGSM& KTCAutoBuildGSM::operator=(const KTCAutoBuildGSM& iOriginal) {
    return *this;
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoBuildGSM::query_factory(CATISpecObject_var object) {
    KTCRelease(geomFactory); // 手动释放 旧的
    if (NULL_var == object) return S_OK;

    // Gets a pointer on CATISpecObject.
    CATILinkableObject* linkObject = NULL;
    HRESULT             rc = object->QueryInterface(IID_CATILinkableObject, (void**)&linkObject);
    if (SUCCEEDED(rc)) {
        // Do not release this pointer
        CATDocument* pDocument = NULL;
        pDocument              = linkObject->GetDocument();

        if (NULL != pDocument) {
            CATIContainerOfDocument* pIContainerOfDocument = NULL;
            rc = pDocument->QueryInterface(IID_CATIContainerOfDocument,
                                           (void**)&pIContainerOfDocument);
            if (SUCCEEDED(rc)) {
                CATIContainer* container = NULL;
                rc                       = pIContainerOfDocument->GetResultContainer(container);
                if (SUCCEEDED(rc)) {
                    rc = container->QueryInterface(IID_CATGeoFactory, (void**)&geomFactory);
                    KTCRelease(container); // 手动释放
                }

                KTCRelease(pIContainerOfDocument); // 手动释放
            }
        }
        pDocument = NULL;       // 不用释放
        KTCRelease(linkObject); // 手动释放
    }
    return rc;
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoBuildGSM::remove(CATBody*& body) {
    if (NULL == body) return S_OK;

    if (geomFactory) {
        // Removes the intermediate CATBody

        // TODO : error C2664: “void CATICGMContainer::Remove(CATICGMObject *,const
        // CATICGMContainer::CATRemovingDependancies)”: 不能将参数 1 从“CATBody
        // *”转换为“CATICGMObject *”
        cout << " 没有实现" << __FUNCTION__ << endl;
        return E_INVALIDARG;
        // geomFactory->Remove(body);
        body = NULL;
        return S_OK;
    }
    return E_INVALIDARG;
}
