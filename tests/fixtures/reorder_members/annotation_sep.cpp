/**
 * @brief 回归用例：注释分隔线（//---static--- / //---INSIDE FUNCTION---）
 * 验证这些注释分隔线不会被吸收进函数块，且不会造成双分隔线。
 */
#include "FooString.h"

//--------------------------------------------------------------------
FooString::FooString()
{
    m_pText = nullptr;
}
//---static-------------------------------------------------
int FooString::compare(const char *other) const
{
    return strcmp(m_pText, other);
}
//---INSIDE FUNCTION----------------------------------------
bool FooString::copy(const char *str, int count)
{
    memcpy(m_pText, str, count);
    return true;
}
//--------------------------------------------------------------------
bool FooString::alpha()
{
    return false;
}
