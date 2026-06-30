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

#ifndef KTCAutoAttrAccess_H
#define KTCAutoAttrAccess_H

// CAT
#include "CATICkeInst.h"
#include "CATICkeParm.h"
#include "CATISpecAttrAccess.h"
#include "CATISpecAttrKey.h"
#include "CATISpecObject.h"
#include "CATLISTV_CATISpecObject.h"
#include "CATListOfCATUnicodeString.h"
#include "CATUnicodeString.h"

// Auto Code
#include "KTCAutoAttrAccess.h"
#include "KTCAutoCodeItf.h"
#include "KtString.h"

/** @brief KTC AutoCode Param */
class ExportedByKTCAutoCodeItf KTCAutoAttrAccess {
public:
    /** @brief Standard constructors and destructors */
    KTCAutoAttrAccess();
    virtual ~KTCAutoAttrAccess();

private:
    /** @brief Copy constructor and equal operator */
    KTCAutoAttrAccess(const KTCAutoAttrAccess&);
    KTCAutoAttrAccess& operator=(const KTCAutoAttrAccess&);

public:
    /**
     * @brief Is Available
     * @return bool
     */
    inline bool available() const {
        return NULL != attrAccess_;
    }

    /**
     * @brief get CATICkeInst_var
     * @param name attribute name
     * @return CATICkeInst_var
     */
    CATICkeInst_var get_CATICkeInst(const char* name) const;

    /**
     * @brief get CATICkeParm pointer
     * @param name attribute name
     * @return CATICkeParm*, Need release by user
     */
    CATICkeParm* get_CATICkeParm(const char* name) const;

    /**
     * @brief get CATISpecAttrKey pointer
     * @param name attribute name
     * @return CATISpecAttrKey*, Need release by user
     */
    CATISpecAttrKey* get_CATISpecAttrKey(const char* name) const;

    /**
     * @brief initial CATISpecAttrAccess
     * @param baseUnkonwn base Unkonwn object
     * @return bool
     */
    HRESULT initial(CATBaseUnknown* baseUnkonwn);

    /**
     * @brief Lists SpecObjects referred to by the attribute.
     * @param attrKey access key to attribute.
     * @return   list of SpecObjects refered by the attribute. it is a list of
     * CATISpecObject. please delete pointer after use
     * @note Do not use.
     */
    CATListValCATBaseUnknown_var* ListSpecObjects(const CATISpecAttrKey* attrKey) const;

    /**
     * @brief set CATISpecAttrAccess
     * @param attrAcess out side CATISpecAttrAccess
     */
    inline void set_CATISpecAttrAccess(CATISpecAttrAccess* attrAcess) {
        attrAccess_ = attrAcess;
    }

public:
    /**
     * @brief Get List Value of CATBaseUnknown_var
     * @param name attribute name
     * @param value output value
     * @return HRESULT
     */
    HRESULT
    GetListValue(const char* name, CATListValCATBaseUnknown_var& value) const;

    /**
     * @brief Get List Value of specobject
     * @param name attribute name
     * @param value output value
     * @return HRESULT
     */
    HRESULT
    GetListValue(const char* name, CATListValCATISpecObject_var& value) const;

    /**
     * @brief Get Value of specobject
     * @param name attribute name
     * @param value output value
     * @return HRESULT
     */
    HRESULT GetSpecValue(const char* name, CATISpecObject_var& value) const;

    /**
     * @brief Get Value of CATBoolean
     * @param name attribute name
     * @param value output value
     * @return HRESULT
     */
    HRESULT GetSpecValue(const char* name, CATBoolean& value) const;

    /**
     * @brief Get Value of int
     * @param name attribute name
     * @param value output value
     * @return HRESULT
     */
    HRESULT GetSpecValue(const char* name, int& value) const;

    /**
     * @brief Get Value of double
     * @param name attribute name
     * @param value output value
     * @return HRESULT
     */
    HRESULT GetSpecValue(const char* name, double& value) const;

    /**
     * @brief Get Value of CATUnicodeString
     * @param name attribute name
     * @param value output value
     * @return HRESULT
     */
    HRESULT GetSpecValue(const char* name, CATUnicodeString& value) const;

    /**
     * @brief Get Value of CATBoolean
     * @param name attribute name
     * @param value output value
     * @return HRESULT
     */
    HRESULT GetValue(const char* name, CATBoolean& value) const;

    /**
     * @brief Get Value of int
     * @param name attribute name
     * @param value output value
     * @return HRESULT
     */
    HRESULT GetValue(const char* name, int& value) const;

    /**
     * @brief Get Value of double
     * @param name attribute name
     * @param value output value
     * @return HRESULT
     */
    HRESULT GetValue(const char* name, double& value) const;

    /**
     * @brief Get Value of CATUnicodeString
     * @param name attribute name
     * @param value output value
     * @return HRESULT
     */
    HRESULT GetValue(const char* name, CATUnicodeString& value) const;

    /**
     * @brief Get Value of KtString
     * @param name attribute name
     * @param value output value
     * @return HRESULT
     */
    HRESULT GetValue(const char* name, KtString& value) const;

public: // Set
    /**
     * @brief Set Spec Value
     * @param name attribute name
     * @param[in] value CATListValCATISpecObject_var
     * @param[in] checkExist whether check exist
     * @return HRESULT
     * @author Phoenix
     */
    HRESULT SetListValue(const char* name, const CATListValCATISpecObject_var& value,
                         CATBoolean checkExist = CATTrue);

    /**
     * @brief Set Spec Value
     * @param name attribute name
     * @param[in] value CATISpecObject_var
     * @param[in] checkExist whether check exist
     * @return HRESULT
     * @author Phoenix
     */
    HRESULT SetSpecValue(const char* name, CATISpecObject_var value,
                         CATBoolean checkExist = CATTrue);

    /**
     * @brief Set Spec Value
     * @param name attribute name
     * @param[in] value CATISpecObject_var
     * @param[in] checkExist whether check exist
     * @return HRESULT
     * @author Phoenix
     */
    HRESULT SetSpecValue(const char* name, CATBoolean value, CATBoolean checkExist = CATTrue);

    /**
     * @brief Set Spec Value
     * @param name attribute name
     * @param[in] value int
     * @param[in] checkExist whether check exist
     * @return HRESULT
     * @author Phoenix
     */
    HRESULT SetSpecValue(const char* name, int value, CATBoolean checkExist = CATTrue);

    /**
     * @brief Set Spec Value
     * @param name attribute name
     * @param[in] value double
     * @param[in] checkExist whether check exist
     * @return HRESULT
     * @author Phoenix
     */
    HRESULT SetSpecValue(const char* name, double value, CATBoolean checkExist = CATTrue);

    /**
     * @brief Set Spec Value
     * @param name attribute name
     * @param[in] value CATUnicodeString
     * @param[in] checkExist whether check exist
     * @return HRESULT
     * @author Phoenix
     */
    HRESULT SetSpecValue(const char* name, const CATUnicodeString& value,
                         CATBoolean checkExist = CATTrue);

    /**
     * @brief Set Value
     * @param name attribute name
     * @param[in] value double
     * @return HRESULT
     * @author Phoenix
     */
    HRESULT SetValue(const char* name, double value, CATBoolean checkExist = CATTrue);

    /**
     * @brief Set Value
     * @param name attribute name
     * @param[in] value int
     * @return HRESULT
     * @author Phoenix
     */
    HRESULT SetValue(const char* name, int value, CATBoolean checkExist = CATTrue);

    /**
     * @brief Set Value
     * @param name attribute name
     * @param[in] value CATBoolean
     * @return HRESULT
     * @author Phoenix
     */
    HRESULT SetValue(const char* name, CATBoolean value, CATBoolean checkExist = CATTrue);

    /**
     * @brief Set Value
     * @param name attribute name
     * @param[in] value CATUnicodeString
     * @return HRESULT
     * @author Phoenix
     */
    HRESULT SetValue(const char* name, const CATUnicodeString& value,
                     CATBoolean checkExist = CATTrue);

    /**
     * @brief Set Value
     * @param name attribute name
     * @param[in] value KtString
     * @return HRESULT
     * @author Phoenix
     */
    HRESULT SetValue(const char* name, const KtString& value, CATBoolean checkExist = CATTrue);

private:
    CATISpecAttrAccess* attrAccess_; ///< attribute access
};

#endif
