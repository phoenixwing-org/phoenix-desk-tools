/**
 * @copyright   Shanghai Kuntai Software Technology Co., Ltd. 2025
 * @license     MIT
 * @author      Phoenix Wing
 * @checkout    KTCAutoCode
 * @file  		KTCAutoAttrAccess.cpp
 * @version		V1.0
 * @date		2025-12-17
 * @brief
 */
// CAT
#include "CATIDescendants.h"
#include "CATIMfBRep.h"
#include "iostream.h"

// auto code
#include "KTCAutoAttrAccess.h"
#include "KTCAutoDefine.h"

/**
 * @brief  获得CATICkeInst_var ckeInst
 * @param TYPE 参数，例如：String，Double，IntBoolean
 */
#define GET_CATICkeInst_DEFAULT(DEFAULT)             \
    CATICkeInst_var ckeInst = get_CATICkeInst(name); \
    if (NULL_var == ckeInst) {                       \
        value = DEFAULT;                             \
        return E_FAIL;                               \
    }

/**
 * @brief 获得CATISpecAttrKey* attrKey
 * @param DEFAULT 默认值
 */
#define GET_CATISpecAttrKey_DEFAULT(DEFAULT)              \
    CATISpecAttrKey* attrKey = get_CATISpecAttrKey(name); \
    if (NULL == attrKey) {                                \
        value = DEFAULT;                                  \
        return E_FAIL;                                    \
    }

/**
 * @brief 通过pecAttrKey 获得值
 * @param DEFAULT 默认值
 * @param TYPE 参数类型，例如：int,double,CATUnicodeString ...
 */
#define GET_VALUE_FROM_SpecAttrKey(DEFAULT, TYPE)         \
    CATISpecAttrKey* attrKey = get_CATISpecAttrKey(name); \
    if (NULL == attrKey) {                                \
        value = DEFAULT;                                  \
        return E_FAIL;                                    \
    }                                                     \
    value = attrAccess_->Get##TYPE(attrKey);              \
    KTCRelease(attrKey)

/**
 * @brief 通过CkePar 设定值
 * @param TYPE 参数类型，例如：int,double,CATUnicodeString ...
 */
#define SET_VALUE_BY_CkeParm(TYPE)                \
    if (checkExist) {                             \
        TYPE    old;                              \
        HRESULT hr = GetSpecValue(name, old);     \
        if (FAILED(hr)) return hr;                \
        if (old == value) return S_OK;            \
    }                                             \
    CATICkeParm* ckeParm = get_CATICkeParm(name); \
    if (NULL == ckeParm) return E_INVALIDARG;     \
    ckeParm->Valuate(value);                      \
    KTCRelease(ckeParm)

/**
 * @brief 通过CATISpecAttrKey 设定值
 * @param TYPE 参数，例如：String，Double，IntBoolean
 */
#define SET_VALUE_BY_SpecAttrKey(TYPE)                            \
    CATISpecAttrKey* attrKey = get_CATISpecAttrKey(name);         \
    if (NULL == attrKey) return E_INVALIDARG;                     \
    HRESULT hr;                                                   \
    if (checkExist && (attrAccess_->Get##TYPE(attrKey) == value)) \
        hr = S_OK;                                                \
    else                                                          \
        hr = attrAccess_->Set##TYPE(attrKey, value);              \
    attrKey->Release();                                           \
    attrKey = NULL;                                               \
    return hr

//-----------------------------------------------------------------------------
KTCAutoAttrAccess::KTCAutoAttrAccess()
    : attrAccess_(NULL) {
}
//-----------------------------------------------------------------------------
KTCAutoAttrAccess::~KTCAutoAttrAccess() {
    attrAccess_ = NULL; // not release
}
//-----------------------------------------------------------------------------
KTCAutoAttrAccess::KTCAutoAttrAccess(const KTCAutoAttrAccess& iOriginal) {
    *this = iOriginal;
}
//-----------------------------------------------------------------------------
KTCAutoAttrAccess& KTCAutoAttrAccess::operator=(const KTCAutoAttrAccess& iOriginal) {
    return *this;
}
//-----------------------------------------------------------------------------
CATICkeInst_var KTCAutoAttrAccess::get_CATICkeInst(const char* name) const {
    // get ckeParm  (内部包含输入检查)
    CATICkeParm* ckeParm = get_CATICkeParm(name);
    if (NULL == ckeParm) return NULL_var;

    // get ckeInst
    CATICkeInst_var ckeInst = ckeParm->Value();
    KTCRelease(ckeParm); // 手动释放
    return ckeInst;
}
//-----------------------------------------------------------------------------
CATICkeParm* KTCAutoAttrAccess::get_CATICkeParm(const char* name) const {
    // get attrkey  (内部包含输入检查)
    CATISpecAttrKey* attrKey = get_CATISpecAttrKey(name);
    if (NULL == attrKey) return NULL;

    // do no need check attrAccess_ here for get_CATISpecAttrKey already check

    CATISpecObject* specObject = attrAccess_->GetSpecObject(attrKey);
    KTCRelease(attrKey); // 手动释放
    if (NULL == specObject) return NULL;

    // get ckeParm
    CATICkeParm* ckeParm = NULL;
    specObject->QueryInterface(IID_CATICkeParm, (void**)&ckeParm);
    return ckeParm;
}
//-----------------------------------------------------------------------------
CATISpecAttrKey* KTCAutoAttrAccess::get_CATISpecAttrKey(const char* name) const {
    // 输入检查
    if (NULL == attrAccess_) return NULL; // check access
    if (NULL == name) return NULL;        // check check null
    if (0 == *name) return NULL;          // check empty
    return attrAccess_->GetAttrKey(name);
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::GetListValue(const char*                   name,
                                        CATListValCATBaseUnknown_var& value) const {
    // 获得 attrKey
    CATISpecAttrKey* attrKey = get_CATISpecAttrKey(name);
    if (NULL == attrKey) {
        value.RemoveAll();
        return E_INVALIDARG;
    }

    // 获得未知类型列表
    CATListValCATBaseUnknown_var* unknownList = ListSpecObjects(attrKey);
    KTCRelease(attrKey); // 手动释放
    if (NULL == unknownList) {
        value.RemoveAll();
        return E_FAIL;
    }

    value = *unknownList; // 拷贝

    delete unknownList, unknownList = NULL; // 手动释放
    return S_OK;                            // 正确
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::GetListValue(const char*                   name,
                                        CATListValCATISpecObject_var& value) const {
    // 获得 attrKey
    CATISpecAttrKey* attrKey = get_CATISpecAttrKey(name);
    if (NULL == attrKey) {
        value.RemoveAll();
        return E_INVALIDARG;
    }

    // 获得未知类型列表
    CATListValCATBaseUnknown_var* unknownList = ListSpecObjects(attrKey);
    KTCRelease(attrKey); // 手动释放
    if (NULL == unknownList) {
        value.RemoveAll();
        return E_FAIL;
    }

    // 申请空间，检查
    HRESULT   hr    = S_OK;
    const int count = unknownList->Size(); // get size
    value.Size(count, NULL);               // 改变空间
    if (value.Size() != count) hr = E_OUTOFMEMORY;

    // 拷贝
    if (SUCCEEDED(hr)) {
        for (int i = 1; i <= count; i++) {
            value[ i ] = (*unknownList)[ i ];
        }
    }

    delete unknownList; // 手动释放, unknownList = NULL
    return S_OK;        // 正确
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::GetSpecValue(const char* name, CATISpecObject_var& value) const {
    GET_VALUE_FROM_SpecAttrKey(NULL_var, SpecObject);
    return S_OK; // 正确
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::GetSpecValue(const char* name, CATBoolean& value) const {
    GET_CATICkeInst_DEFAULT(0);        // 检出 ckeInst
    value = (int)ckeInst->AsBoolean(); // 得到值
    return S_OK;                       // 正确
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::GetSpecValue(const char* name, int& value) const {
    GET_CATICkeInst_DEFAULT(0);   // 检出 ckeInst
    value = ckeInst->AsInteger(); // 得到值
    return S_OK;                  // 正确
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::GetSpecValue(const char* name, double& value) const {
    GET_CATICkeInst_DEFAULT(0.0); // 检出 ckeInst
    value = ckeInst->AsReal();    // 得到值
    return S_OK;                  // 正确
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::GetSpecValue(const char* name, CATUnicodeString& value) const {
    GET_CATICkeInst_DEFAULT(""); // 检出 ckeInst
    value = ckeInst->AsString(); // 得到值
    return S_OK;                 // 正确
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::GetValue(const char* name, CATBoolean& value) const {
    GET_CATISpecAttrKey_DEFAULT(0);           // 检出 attrKey
    value = attrAccess_->GetBoolean(attrKey); // 得到值
    KTCRelease(attrKey);                      // 手动释放
    return S_OK;                              // 正确
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::GetValue(const char* name, int& value) const {
    GET_CATISpecAttrKey_DEFAULT(0);           // 检出 attrKey
    value = attrAccess_->GetInteger(attrKey); // 得到值
    KTCRelease(attrKey);                      // 手动释放
    return S_OK;                              // 正确
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::GetValue(const char* name, double& value) const {
    GET_CATISpecAttrKey_DEFAULT(0.0);        // 检出 attrKey
    value = attrAccess_->GetDouble(attrKey); // 得到值
    KTCRelease(attrKey);                     // 手动释放
    return S_OK;                             // 正确
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::GetValue(const char* name, CATUnicodeString& value) const {
    GET_CATISpecAttrKey_DEFAULT("");         // 检出 attrKey
    value = attrAccess_->GetString(attrKey); // 得到值
    KTCRelease(attrKey);                     // 手动释放
    return S_OK;                             // 正确
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::GetValue(const char* name, KtString& value) const {
    GET_CATISpecAttrKey_DEFAULT("");                         // 检出 attrKey
    value = attrAccess_->GetString(attrKey).ConvertToChar(); // 得到值
    KTCRelease(attrKey);                                     // 手动释放
    return S_OK;                                             // 正确
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::initial(CATBaseUnknown* baseUnkonwn) {
    // clear and check input
    attrAccess_ = NULL;
    if (!baseUnkonwn) return E_POINTER;

    // QueryInterface
    return baseUnkonwn->QueryInterface(IID_CATISpecAttrAccess, (void**)&attrAccess_);
}
//----------------------------------------
CATListValCATBaseUnknown_var*
    KTCAutoAttrAccess::ListSpecObjects(const CATISpecAttrKey* attrKey) const {
    if (NULL == attrKey || NULL == attrAccess_) return NULL; // 检查
    return attrAccess_->ListSpecObjects(attrKey);
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::SetListValue(const char* name, const CATListValCATISpecObject_var& value,
                                        CATBoolean checkExist) {
    // 检出 attrKey
    CATISpecAttrKey* attrKey = get_CATISpecAttrKey(name);
    if (NULL == attrKey) return E_INVALIDARG;

    HRESULT hr = E_FAIL;
    // check exist
    if (checkExist) {

        CATListValCATBaseUnknown_var* unknownList = attrAccess_->ListSpecObjects(attrKey);

        if (unknownList && unknownList->Size() == value.Size()) {
            // start from 1
            for (int i = 1; i <= value.Size(); i++) {
                if ((*unknownList)[ i ] != value[ i ]) {
                    // 是否可以判断出一致，有待校验 不检查 hr
                    attrAccess_->SetSpecObject(attrKey, value[ i ], i); // set no. i.
                }
            }
            hr = S_OK;
        }
        delete unknownList; // 手动释放
        if (SUCCEEDED(hr)) {
            KTCRelease(attrKey); // 手动释放
            return hr;
        }
    }

    // 清空值
    hr = attrAccess_->UnsetAttributeValue(attrKey);
    if (FAILED(hr)) {
        cout << " -[ERROR] when UnsetAttributeValue `" << name << endl;
        // return hr;
    }

    cout << " - add list value `" << name << "`: count =" << value.Size() << endl;
    // 逐个添加  start from 1
    for (int i = 1; i <= value.Size(); i++) {
        // 是否可以判断出一致，有待校验 不检查 hr
        hr = attrAccess_->SetSpecObject(attrKey, value[ i ], i); // set no. i.
        cout << "    - add No." << i << endl;
        if (FAILED(hr)) {
            cout << " -[ERROR] when SetSpecObject() for No. `" << i << endl;
            // return hr;
        }
    }

    KTCRelease(attrKey); // 手动释放
    return S_OK;
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::SetSpecValue(const char* name, CATISpecObject_var value,
                                        CATBoolean checkExist) {
    HRESULT hr;
    // 1. 检查旧值，防止触发更新标记
    if (checkExist) {
        CATISpecObject_var old;        // 旧值
        hr = GetSpecValue(name, old);  // 检索旧值
        if (FAILED(hr)) return hr;     // 检索出错
        if (old == value) return S_OK; // 相同
    }

    // 2.检索 CATISpecAttrKey
    CATISpecAttrKey* attrKey = get_CATISpecAttrKey(name);
    if (NULL == attrKey) return E_INVALIDARG;

    // 分情况设定
    if (NULL_var == value) { // 设置空的值
        attrAccess_->UnsetAttributeValue(attrKey);
    }
    else { // 设置非空的值

        // 处理Brep
        CATIMfBRep_var bRep;
        value->QueryInterface(IID_CATIMfBRep, (void**)&bRep); // 不检查返回值
        if (!!bRep) {
            // 检出BRep，说明是拓扑

            // 获得父亲，进行处理
            CATISpecObject_var father = value->GetFather();
            if (NULL_var == father) {
                // 如果没有父亲，要放到当前的attrAccess_下
                // 如果检出attrAccess_，保留hr值
                CATIDescendants* descendants = NULL;
                hr = attrAccess_->QueryInterface(IID_CATIDescendants, (void**)&descendants);
                if (descendants) {
                    descendants->Append(value);
                    KTCRelease(descendants); // 手动释放
                }
            }
            else {
                hr = E_FAIL; // 父亲不能存在，报错
            }
        }

        // 如果上述没有报错，设定值
        if (SUCCEEDED(hr)) hr = attrAccess_->SetSpecObject(attrKey, value);
    }

    KTCRelease(attrKey); // 手动释放
    return hr;
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::SetSpecValue(const char* name, CATBoolean value, CATBoolean checkExist) {
    SET_VALUE_BY_CkeParm(CATBoolean); // 通过参数特征设定值
    return S_OK;
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::SetSpecValue(const char* name, int value, CATBoolean checkExist) {
    SET_VALUE_BY_CkeParm(int); // 通过参数特征设定值
    return S_OK;
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::SetSpecValue(const char* name, double value, CATBoolean checkExist) {
    SET_VALUE_BY_CkeParm(double); // 通过参数特征设定值
    return S_OK;
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::SetSpecValue(const char* name, const CATUnicodeString& value,
                                        CATBoolean checkExist) {
    SET_VALUE_BY_CkeParm(CATUnicodeString); // 通过参数特征设定值
    return S_OK;
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::SetValue(const char* name, int value, CATBoolean checkExist) {
    SET_VALUE_BY_SpecAttrKey(Integer); // 设定值
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::SetValue(const char* name, double value, CATBoolean checkExist) {
    SET_VALUE_BY_SpecAttrKey(Double); // 设定值
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::SetValue(const char* name, CATBoolean value, CATBoolean checkExist) {
    SET_VALUE_BY_SpecAttrKey(Boolean); // 设定值
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::SetValue(const char* name, const CATUnicodeString& value,
                                    CATBoolean checkExist) {
    SET_VALUE_BY_SpecAttrKey(String); // 设定值
}
//-----------------------------------------------------------------------------
HRESULT KTCAutoAttrAccess::SetValue(const char* name, const KtString& iValue,
                                    CATBoolean checkExist) {
    CATUnicodeString value = iValue.str();
    SET_VALUE_BY_SpecAttrKey(String); // 设定值
}
