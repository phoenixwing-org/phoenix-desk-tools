/**
 * @brief 回归用例：函数体内调用同类方法
 * 验证函数体内的 ClassName::method() 调用（如 copy() 内调用 safeDelete()）
 * 不会被提取为独立函数块。
 */
#include "FooString.h"

//--------------------------------------------------------------------
FooString::FooString()
{
    FooString::init(nullptr);
}
//--------------------------------------------------------------------
void FooString::init(void *ptr)
{
    m_ptr = ptr;
    if (ptr != nullptr)
    {
        FooString::safeDelete(m_ptr);
    }
}
//----static----------------------------------------------------------------
void FooString::safeDelete(void *ipData)
{
    if (ipData != nullptr)
    {
        delete[] (char *)ipData;
    }
}
